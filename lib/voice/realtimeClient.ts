// A thin wrapper round the WebRTC connection to the OpenAI Realtime API.
//
//   connect: mic track (or a receive-only audio transceiver when there is no mic,
//            text-only mode) -> data channel "oai-events" -> offer -> POST the SDP
//            to /v1/realtime/calls with the ephemeral key -> apply the answer
//   send:    one client event as JSON on the data channel
//   close:   channel, peer and mic tracks, once
//
// The model's voice arrives as a media track and is played on the <audio> element
// the UI owns. Events arrive on the data channel and are parsed with
// parseServerEvent; ones the app does not use are dropped here.
//
// Failures of the SDP exchange are a RealtimeConnectError: `expired` for a 401
// (the ephemeral key lives ~120 s, so the caller may re-mint once), and
// `connect-failed` for anything else. A failed connect closes the peer but leaves
// the mic running, so a retry can reuse the stream the user already granted.
//
// The peer connection and fetch are injectable, so the whole flow is testable
// without a browser. The client secret is used for the one POST and not kept.

import { parseServerEvent } from './realtimeEvents'
import type { ClientEvent, ServerEvent } from './realtimeEvents'

export const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls'
const DATA_CHANNEL_LABEL = 'oai-events'
const SDP_TIMEOUT_MS = 15_000
const HTTP_UNAUTHORIZED = 401

export type RealtimeConnectErrorKind = 'connect-failed' | 'expired'

/** The SDP exchange failed. `message` is the kind, so a plain Error check still reads it. */
export class RealtimeConnectError extends Error {
  readonly kind: RealtimeConnectErrorKind

  constructor(kind: RealtimeConnectErrorKind) {
    super(kind)
    this.name = 'RealtimeConnectError'
    this.kind = kind
  }
}

export interface RealtimeClientDeps {
  createPeerConnection?: () => RTCPeerConnection
  fetchImpl?: typeof fetch
}

export interface RealtimeConnectOptions {
  clientSecret: string
  /** The granted mic, or null for text-only (the model still answers aloud). */
  micStream: MediaStream | null
  /** Where the model's voice plays. Null is allowed (nothing is played). */
  audioEl: HTMLAudioElement | null
  onEvent: (event: ServerEvent) => void
  /** The data channel closed without close() being called. */
  onClose: () => void
}

/** What the session hook needs from a client; the hook's tests inject a fake. */
export interface RealtimeClientLike {
  connect(options: RealtimeConnectOptions): Promise<void>
  send(event: ClientEvent): boolean
  setMuted(muted: boolean): void
  close(): void
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined
}

function playRemote(audioEl: HTMLAudioElement | null, streams: readonly MediaStream[]): void {
  if (!audioEl || streams.length === 0) return
  audioEl.srcObject = streams[0]
  // Autoplay may be refused until a gesture; the element is autoPlay and the
  // session continues as text either way, so there is nothing to report.
  audioEl.play().catch(() => undefined)
}

export class RealtimeClient implements RealtimeClientLike {
  private readonly createPeerConnection: () => RTCPeerConnection
  private readonly fetchImpl: typeof fetch
  private pc: RTCPeerConnection | null = null
  private dc: RTCDataChannel | null = null
  private mic: MediaStream | null = null
  private closed = false

  constructor(deps: RealtimeClientDeps = {}) {
    this.createPeerConnection = deps.createPeerConnection ?? (() => new RTCPeerConnection())
    this.fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init))
  }

  async connect(options: RealtimeConnectOptions): Promise<void> {
    const pc = this.createPeerConnection()
    this.pc = pc
    this.mic = options.micStream
    this.closed = false
    pc.ontrack = (event: RTCTrackEvent) => playRemote(options.audioEl, event.streams)
    this.attachAudio(pc, options.micStream)
    this.dc = this.openChannel(pc, options)
    try {
      await this.exchangeSdp(pc, options.clientSecret)
    } catch (error) {
      this.teardown(false)
      throw error instanceof RealtimeConnectError ? error : new RealtimeConnectError('connect-failed')
    }
  }

  send(event: ClientEvent): boolean {
    if (!this.dc || this.dc.readyState !== 'open') return false
    this.dc.send(JSON.stringify(event))
    return true
  }

  setMuted(muted: boolean): void {
    for (const track of this.mic?.getAudioTracks() ?? []) track.enabled = !muted
  }

  close(): void {
    if (this.closed) return
    this.teardown(true)
  }

  private attachAudio(pc: RTCPeerConnection, micStream: MediaStream | null): void {
    if (micStream) {
      for (const track of micStream.getAudioTracks()) pc.addTrack(track, micStream)
      return
    }
    // No mic: still offer an audio m-line so the model's voice comes back.
    pc.addTransceiver('audio', { direction: 'recvonly' })
  }

  private openChannel(pc: RTCPeerConnection, options: RealtimeConnectOptions): RTCDataChannel {
    const dc = pc.createDataChannel(DATA_CHANNEL_LABEL)
    dc.onmessage = (message: MessageEvent) => {
      const event = parseServerEvent(message.data)
      if (event) options.onEvent(event)
    }
    dc.onclose = () => {
      if (!this.closed) options.onClose()
    }
    return dc
  }

  private async exchangeSdp(pc: RTCPeerConnection, clientSecret: string): Promise<void> {
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    const res = await this.fetchImpl(REALTIME_CALLS_URL, {
      method: 'POST',
      body: offer.sdp,
      headers: { Authorization: `Bearer ${clientSecret}`, 'Content-Type': 'application/sdp' },
      signal: timeoutSignal(SDP_TIMEOUT_MS),
    })
    if (res.status === HTTP_UNAUTHORIZED) throw new RealtimeConnectError('expired')
    if (!res.ok) throw new RealtimeConnectError('connect-failed')
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() })
  }

  /** Close the channel and the peer; stop the mic only when the session is over. */
  private teardown(stopMic: boolean): void {
    this.closed = true
    this.dc?.close()
    this.pc?.close()
    if (stopMic) for (const track of this.mic?.getTracks() ?? []) track.stop()
    this.dc = null
    this.pc = null
    if (stopMic) this.mic = null
  }
}
