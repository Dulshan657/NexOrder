// The WebRTC wrapper, driven against a fake RTCPeerConnection and a fake fetch.
// No browser: what matters is the order of the calls, the SDP POST and what the
// data channel is allowed to do.

import { describe, expect, it, vi } from 'vitest'
import { REALTIME_CALLS_URL, RealtimeClient, RealtimeConnectError } from '@/lib/voice/realtimeClient'
import { responseCreate } from '@/lib/voice/realtimeEvents'

class FakeChannel {
  readyState = 'open'
  onmessage: ((m: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = 'closed'
  })
}

class FakePeer {
  ontrack: ((e: { streams: unknown[] }) => void) | null = null
  channel = new FakeChannel()
  addTrack = vi.fn()
  addTransceiver = vi.fn()
  createDataChannel = vi.fn(() => this.channel)
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'OFFER-SDP' }))
  setLocalDescription = vi.fn(async () => undefined)
  setRemoteDescription = vi.fn(async () => undefined)
  close = vi.fn()
}

function micStream() {
  const track = { kind: 'audio', enabled: true, stop: vi.fn() }
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
  return { track, stream: stream as unknown as MediaStream }
}

function setup(response: () => Promise<Response> = async () => new Response('ANSWER-SDP', { status: 201 })) {
  const peer = new FakePeer()
  const fetchImpl = vi.fn(response)
  const client = new RealtimeClient({
    createPeerConnection: () => peer as unknown as RTCPeerConnection,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  })
  const onEvent = vi.fn()
  const onClose = vi.fn()
  return { peer, fetchImpl, client, onEvent, onClose }
}

describe('RealtimeClient', () => {
  it('adds the mic, opens oai-events, posts the offer and applies the answer', async () => {
    const { peer, fetchImpl, client, onEvent, onClose } = setup()
    const { track, stream } = micStream()
    await client.connect({ clientSecret: 'ek_test', micStream: stream, audioEl: null, onEvent, onClose })

    expect(peer.addTrack).toHaveBeenCalledWith(track, stream)
    expect(peer.addTransceiver).not.toHaveBeenCalled()
    expect(peer.createDataChannel).toHaveBeenCalledWith('oai-events')
    expect(peer.setLocalDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'OFFER-SDP' })

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(REALTIME_CALLS_URL)
    expect(url).toBe('https://api.openai.com/v1/realtime/calls')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('OFFER-SDP')
    expect(init.headers).toEqual({ Authorization: 'Bearer ek_test', 'Content-Type': 'application/sdp' })
    expect(init.signal).toBeDefined()
    expect(peer.setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'ANSWER-SDP' })
  })

  it('adds a recvonly audio transceiver when there is no mic (text-only)', async () => {
    const { peer, client, onEvent, onClose } = setup()
    await client.connect({ clientSecret: 'ek_test', micStream: null, audioEl: null, onEvent, onClose })
    expect(peer.addTrack).not.toHaveBeenCalled()
    expect(peer.addTransceiver).toHaveBeenCalledWith('audio', { direction: 'recvonly' })
  })

  it('plays the remote stream on the audio element and survives a refused autoplay', async () => {
    const { peer, client, onEvent, onClose } = setup()
    const play = vi.fn(() => Promise.reject(new Error('NotAllowedError')))
    const audioEl = { srcObject: null as unknown, play } as unknown as HTMLAudioElement
    await client.connect({ clientSecret: 'ek_test', micStream: null, audioEl, onEvent, onClose })
    const remote = { id: 'remote' }
    peer.ontrack?.({ streams: [remote] })
    expect((audioEl as unknown as { srcObject: unknown }).srcObject).toBe(remote)
    expect(play).toHaveBeenCalledTimes(1)
    await Promise.resolve()
  })

  it('parses data-channel messages and drops ones it does not use', async () => {
    const { peer, client, onEvent, onClose } = setup()
    await client.connect({ clientSecret: 'ek_test', micStream: null, audioEl: null, onEvent, onClose })
    peer.channel.onmessage?.({ data: 'not json' })
    peer.channel.onmessage?.({ data: JSON.stringify({ type: 'rate_limits.updated' }) })
    peer.channel.onmessage?.({ data: JSON.stringify({ type: 'session.created', session: { id: 's1' } }) })
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent.mock.calls[0][0]).toMatchObject({ type: 'session.created' })
  })

  it('reports a channel closed by the far side, but not one it closed itself', async () => {
    const first = setup()
    await first.client.connect({ clientSecret: 'ek', micStream: null, audioEl: null, onEvent: first.onEvent, onClose: first.onClose })
    first.peer.channel.onclose?.()
    expect(first.onClose).toHaveBeenCalledTimes(1)

    const second = setup()
    await second.client.connect({ clientSecret: 'ek', micStream: null, audioEl: null, onEvent: second.onEvent, onClose: second.onClose })
    second.client.close()
    second.peer.channel.onclose?.()
    expect(second.onClose).not.toHaveBeenCalled()
  })

  it('sends JSON only while the channel is open', async () => {
    const { peer, client, onEvent, onClose } = setup()
    await client.connect({ clientSecret: 'ek', micStream: null, audioEl: null, onEvent, onClose })
    expect(client.send(responseCreate())).toBe(true)
    expect(peer.channel.send).toHaveBeenCalledWith(JSON.stringify({ type: 'response.create' }))
    peer.channel.readyState = 'closing'
    expect(client.send(responseCreate())).toBe(false)
    expect(peer.channel.send).toHaveBeenCalledTimes(1)
  })

  it('mutes by disabling the mic tracks', async () => {
    const { client, onEvent, onClose } = setup()
    const { track, stream } = micStream()
    await client.connect({ clientSecret: 'ek', micStream: stream, audioEl: null, onEvent, onClose })
    client.setMuted(true)
    expect(track.enabled).toBe(false)
    client.setMuted(false)
    expect(track.enabled).toBe(true)
  })

  it('close() closes the channel and the peer and stops the mic, once', async () => {
    const { peer, client, onEvent, onClose } = setup()
    const { track, stream } = micStream()
    await client.connect({ clientSecret: 'ek', micStream: stream, audioEl: null, onEvent, onClose })
    client.close()
    client.close()
    expect(peer.channel.close).toHaveBeenCalledTimes(1)
    expect(peer.close).toHaveBeenCalledTimes(1)
    expect(track.stop).toHaveBeenCalled()
  })

  it('a 401 from the SDP POST is an expired key', async () => {
    const { peer, client, onEvent, onClose } = setup(async () => new Response('nope', { status: 401 }))
    const attempt = client.connect({ clientSecret: 'ek', micStream: null, audioEl: null, onEvent, onClose })
    await expect(attempt).rejects.toBeInstanceOf(RealtimeConnectError)
    await expect(attempt).rejects.toMatchObject({ kind: 'expired', message: 'expired' })
    expect(peer.close).toHaveBeenCalled()
  })

  it('any other non-2xx, or a network failure, is connect-failed', async () => {
    const bad = setup(async () => new Response('boom', { status: 500 }))
    await expect(
      bad.client.connect({ clientSecret: 'ek', micStream: null, audioEl: null, onEvent: bad.onEvent, onClose: bad.onClose }),
    ).rejects.toMatchObject({ kind: 'connect-failed', message: 'connect-failed' })

    const offline = setup(async () => Promise.reject(new TypeError('Failed to fetch')))
    await expect(
      offline.client.connect({ clientSecret: 'ek', micStream: null, audioEl: null, onEvent: offline.onEvent, onClose: offline.onClose }),
    ).rejects.toMatchObject({ kind: 'connect-failed' })
    expect(offline.peer.setRemoteDescription).not.toHaveBeenCalled()
  })

  it('does not stop the mic when a connect fails, so a retry can reuse it', async () => {
    const { client, onEvent, onClose } = setup(async () => new Response('', { status: 401 }))
    const { track, stream } = micStream()
    await expect(client.connect({ clientSecret: 'ek', micStream: stream, audioEl: null, onEvent, onClose })).rejects.toThrow()
    expect(track.stop).not.toHaveBeenCalled()
  })
})
