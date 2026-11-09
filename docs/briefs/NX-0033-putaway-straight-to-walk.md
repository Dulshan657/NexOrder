# NX-0033 — Putaway goes straight onto the walk

```json brief
{
  "id": "NX-0033-putaway-straight-to-walk",
  "base": "abc4337b2ae1bd3de5ffc9956151acdf0dea05d4",
  "approved": "2026-11-09 owner, by standing go-ahead on the design; text not yet read, owner to confirm before the PR",
  "acceptance": [
    { "id": "A1", "check": "A line whose product's home has room is created assigned to the home bin with no assigner (assigned_by NULL) and is on the Walk; it never appears in the Assign queue.", "manual": "npm run test:integration -- putawayStraightToWalk (recommend-putaway over HTTP) on dev; the Playwright run (A9) for the Walk-and-not-the-queue half" },
    { "id": "A2", "check": "A loose line sent to overflow (home full) is created suggested; it is listed in the Assign queue and as a confirm stop on the Walk ('Home full — put in {bin}?'). Assign or Choose bin at the desk, or scanning the suggested bin on the walk, confirms it; the first wins, the other is refused with CONFLICT, and the line leaves the other list. A scan of any other bin on a confirm stop is refused. A single-product pallet is never a confirm stop.", "manual": "npm run test:integration -- putawayStraightToWalk (wie_confirm_overflow_tx, wie_putaway_stops, decide-putaway confirm_overflow over HTTP) on dev; the Playwright run (A9)" },
    { "id": "A3", "check": "A line for a product with no home, and a single-product pallet (unit load) of any product, is created assigned to the engine's bin and is on the Walk.", "manual": "npm run test:integration -- putawayStraightToWalk (recommend-putaway over HTTP: a product with no home, and a hu_type pallet) on dev" },
    { "id": "A4", "check": "On a walk stop for a product with no home, a Manager or Admin is offered 'This product has no home bin. Give it one?' and can choose a bin by scanning, typing or a dropdown that lists only bins that pass the home-bin health rules and are no other product's home; the putaway then goes to that bin and the bin becomes the product's primary home in the same transaction. The line's own reservation does not make its bin read as full. 'Not now' keeps the engine's bin. complete-putaway refuses make_home into a bin that fails those rules with '{code} can't be a home bin: ...'.", "manual": "npm run test:integration -- putawayStraightToWalk (home-bin-choices and complete-putaway make_home over HTTP, wie_home_bin_candidate_facts) on dev; the Playwright run (A9)" },
    { "id": "A5", "check": "complete-putaway refuses make_home from any role other than Admin or Manager with FORBIDDEN 'Only a Manager or Admin can give a product a home bin.', before reading the task; a Warehouse user is not offered the choice on the walk.", "manual": "npm run test:integration -- putawayStraightToWalk (made-up Warehouse user over HTTP) on dev; the Playwright run (A9) for a forged make_home" },
    { "id": "A6", "check": "The same overflow line confirmed at the desk and on the walk at once ends with exactly one assignment and no stock moved; a walk completion and a desk Place now at once move the stock exactly once.", "manual": "npm run test:integration -- putawayStraightToWalk, race describe (two connections) on dev" },
    { "id": "A7", "check": "A line the system assigned and nobody has touched can still be placed from the receive card (Accept, Choose another) and by the opening-stock import (decide override); a line a person assigned cannot be placed that way.", "manual": "npm run test:integration -- putawayStraightToWalk (wie_decide_putaway_tx, and decide-putaway accept on a system-assigned line over HTTP) on dev" },
    { "id": "A8", "check": "The Bin detail panel (and the Locations panel) on Warehouse setup scrolls with the mouse wheel.", "manual": "npx playwright test tests/e2e/rack-levels/bin-detail-wheel.spec.ts against dev (red on the base, green on the tip)" },
    { "id": "A9", "check": "End to end on dev in a browser with made-up products only: a homed product's line is on the Walk and not the Assign queue and completes at the home; with the home full the overflow line shows in both lists and confirming on the walk removes it from the Assign queue, and confirming at the desk turns the walk stop into a plain stop; a product with no home is on the walk and an Admin gives it a home by scan, by typing and by dropdown; a Warehouse user is offered nothing and a forged make_home is refused.", "manual": "npx playwright test tests/e2e/rack-levels/putaway-straight-to-walk.spec.ts --project=chromium against dev with this branch's frontend served locally, trace and screenshots kept outside git" },
    { "id": "A10", "check": "Migrations 00143, 00144, 00145 and 00146 applied to dev and the changed functions deployed to dev.", "manual": "npm run migrate:dev; the Supabase CLI deploy to dev, with the owner's consent, of the 10 functions that bundle a changed shared module: adjust-stock, break-down-putaway, complete-putaway, count-bin, decide-putaway, home-bin-choices, home-bin-health, receive-stock, recommend-putaway, transfer-stock, built from a merge of origin/main and this branch" },
    { "id": "A11", "check": "A quarantined (held) line goes to its hold bin: for a homed product it is created assigned to the hold bin with source engine and is on the Walk, never a 'Home full' confirm stop; the home rule does not refuse a putaway into a hold bin while the home has room (confirm, assign, Place now, complete); the walk does not offer 'Give it a home' on a stop at a hold bin; and complete-putaway refuses make_home on a held line with CONFLICT 'A held line can't make a home bin.'", "manual": "npm run test:integration -- homeBinEnforced and putawayStraightToWalk on dev (00146 live RPCs; recommend-putaway with quarantine and complete-putaway make_home over HTTP after the deploy); the walk's hidden offer by putawayWalkConfirmStops and putawayStopCardGiveHome on the tip" }
  ],
  "failFirst": [
    {"file":"__tests__/floatingPanel.test.tsx","test":"FloatingPanel > the body is bounded by its row, so it is the element that scrolls","proves":["A8"]},
    {"file":"__tests__/giveHomeSheet.test.tsx","test":"GiveHomeSheet > is titled with the product","proves":["A4"]},
    {"file":"__tests__/giveHomeSheet.test.tsx","test":"GiveHomeSheet > asks for the bins of this product, on this line's own terms, only while open","proves":["A4"]},
    {"file":"__tests__/giveHomeSheet.test.tsx","test":"GiveHomeSheet > a scanned code that is offered is chosen","proves":["A4"]},
    {"file":"__tests__/giveHomeSheet.test.tsx","test":"GiveHomeSheet > a scanned code that is not offered is refused with the copy","proves":["A4"]},
    {"file":"__tests__/giveHomeSheet.test.tsx","test":"GiveHomeSheet > typing a code and pressing Make this its home chooses it","proves":["A4"]},
    {"file":"__tests__/giveHomeSheet.test.tsx","test":"GiveHomeSheet > typing a code that is not offered and pressing Make this its home refuses it","proves":["A4"]},
    {"file":"__tests__/giveHomeSheet.test.tsx","test":"GiveHomeSheet > picking from the dropdown and pressing Make this its home chooses it","proves":["A4"]},
    {"file":"__tests__/giveHomeSheet.test.tsx","test":"GiveHomeSheet > lists each bin as its code and its name, or the code alone when it has no name","proves":["A4"]},
    {"file":"__tests__/giveHomeSheet.test.tsx","test":"GiveHomeSheet > does nothing until a bin is named","proves":["A4"]},
    {"file":"__tests__/giveHomeSheet.test.tsx","test":"GiveHomeSheet > prefers the typed code over the dropdown when both are filled","proves":["A4"]},
    {"file":"__tests__/giveHomeSheet.test.tsx","test":"GiveHomeSheet > a refused code is cleared when a bin is picked from the list instead","proves":["A4"]},
    {"file":"__tests__/giveHomeSheet.test.tsx","test":"GiveHomeSheet > says when no bin can be a home","proves":["A4"]},
    {"file":"__tests__/giveHomeSheet.test.tsx","test":"GiveHomeSheet > says it is loading rather than that no bin can be a home","proves":["A4"]},
    {"file":"__tests__/giveHomeSheet.test.tsx","test":"GiveHomeSheet > shows the server's words when the list could not be read","proves":["A4"]},
    {"file":"__tests__/giveHomeSheet.test.tsx","test":"GiveHomeSheet > closes without choosing","proves":["A4"]},
    {"file":"__tests__/homeBinHealthLoad.test.ts","test":"loadHomeBinChoices > calls wie_home_bin_candidate_facts with the warehouse and product, and throws on a read error","proves":["A4"]},
    {"file":"__tests__/homeBinHealthLoad.test.ts","test":"loadHomeBinChoices > gives the lines being placed their own space back: p_exclude_rec_ids goes through, and only when there are some","proves":["A4"]},
    {"file":"__tests__/homeBinHealthLoad.test.ts","test":"loadHomeBinChoices > returns the bins that qualify, by code, and drops the rest","proves":["A4"]},
    {"file":"__tests__/homeBinHealthLoad.test.ts","test":"loadHomeBinChoices > fills in the slotting refusal, so a bin a hard rule excludes is not offered","proves":["A4"]},
    {"file":"__tests__/homeBinHealthLoad.test.ts","test":"loadHomeBinChoices > fails closed when the slotting rules cannot be read","proves":["A4"]},
    {"file":"__tests__/homeBinHealthLoad.test.ts","test":"loadHomeChoiceRefusal > passes p_bin_id and returns the refusal for that one bin","proves":["A4"]},
    {"file":"__tests__/homeBinHealthLoad.test.ts","test":"loadHomeChoiceRefusal > passes the lines being placed as p_exclude_rec_ids, with the bin","proves":["A4"]},
    {"file":"__tests__/homeBinHealthLoad.test.ts","test":"loadHomeChoiceRefusal > leaves p_exclude_rec_ids out when no line is named","proves":["A4"]},
    {"file":"__tests__/homeBinHealthLoad.test.ts","test":"loadHomeChoiceRefusal > names the other product when the bin is already somebody else's home","proves":["A4"]},
    {"file":"__tests__/homeBinHealthLoad.test.ts","test":"loadHomeChoiceRefusal > is null for a bin that can be the home","proves":["A4"]},
    {"file":"__tests__/homeBinHealthLoad.test.ts","test":"loadHomeChoiceRefusal > refuses a location the function returns no row for, as not a bin of this warehouse","proves":["A4"]},
    {"file":"__tests__/homeBinHealthLoad.test.ts","test":"loadHomeChoiceRefusal > throws on a read error","proves":["A4"]},
    {"file":"__tests__/homeBinHealthLoad.test.ts","test":"loadHomeChoiceRefusal > applies a slotting refusal to the one bin","proves":["A4"]},
    {"file":"__tests__/homeBinHealthService.test.ts","test":"getHomeBinChoices > GETs home-bin-choices with both ids in the query string","proves":["A4"]},
    {"file":"__tests__/homeBinHealthService.test.ts","test":"getHomeBinChoices > adds the line being placed to the query string, so its own space is not counted","proves":["A4"]},
    {"file":"__tests__/homeBinHealthService.test.ts","test":"getHomeBinChoices > returns the bins the server offers","proves":["A4"]},
    {"file":"__tests__/homeBinHealthService.test.ts","test":"getHomeBinChoices > tolerates a reply with no bins","proves":["A4"]},
    {"file":"__tests__/homeBinHealthService.test.ts","test":"getHomeBinChoices > surfaces the server message on a failure, not the generic non-2xx one","proves":["A4"]},
    {"file":"__tests__/homeBinHealthService.test.ts","test":"getHomeBinChoices > falls back to a readable message when the body carries none","proves":["A4"]},
    {"file":"__tests__/homeBinHealthService.test.ts","test":"getHomeBinChoices > throws when the call succeeds but returns nothing","proves":["A4"]},
    {"file":"__tests__/putawayCompletion.test.ts","test":"decidePutawayCompletion > make_home only when the product has no home","proves":["A4"]},
    {"file":"__tests__/putawayCompletion.test.ts","test":"decidePutawayCompletion > make_home is refused for a Warehouse user even when the product has no home","proves":["A5"]},
    {"file":"__tests__/putawayCompletion.test.ts","test":"canSetHome > only Admin and Manager","proves":["A5"]},
    {"file":"__tests__/putawayCompletion.test.ts","test":"canPlaceNow > a suggested line, or one the system assigned and nobody touched","proves":["A7"]},
    {"file":"__tests__/putawayCompletion.test.ts","test":"decisionActsOnStatus > unassign acts on an assigned line only","proves":["A7"]},
    {"file":"__tests__/putawayCompletion.test.ts","test":"decisionActsOnStatus > place now (accept / override) also acts on a line the system assigned","proves":["A7"]},
    {"file":"__tests__/putawayCompletion.test.ts","test":"decisionActsOnStatus > a desk assign (assign_only) still needs a suggested line, whoever assigned it","proves":["A7"]},
    {"file":"__tests__/putawayCompletion.test.ts","test":"decisionActsOnStatus > a walk confirm leaves the status check to the database, which says why in plain words","proves":["A2"]},
    {"file":"__tests__/putawayInvalidation.test.tsx","test":"useConfirmOverflow cache invalidation > refreshes the queue, the counts and the route after a confirm","proves":["A2"]},
    {"file":"__tests__/putawayInvalidation.test.tsx","test":"useConfirmOverflow cache invalidation > refreshes the queue, the counts and the route after a refusal","proves":["A2"]},
    {"file":"__tests__/putawayQueuePageCanSetHome.test.tsx","test":"PutawayQueuePage — who is offered \"give it a home\" > Admin -> canSetHome true","proves":["A4"]},
    {"file":"__tests__/putawayQueuePageCanSetHome.test.tsx","test":"PutawayQueuePage — who is offered \"give it a home\" > Manager -> canSetHome true","proves":["A4"]},
    {"file":"__tests__/putawayQueuePageCanSetHome.test.tsx","test":"PutawayQueuePage — who is offered \"give it a home\" > Warehouse -> canSetHome false","proves":["A4","A5"]},
    {"file":"__tests__/putawayQueueService.test.ts","test":"getWalkPutaways > maps the assigned bin and its timestamp onto the row","proves":["A1","A2"]},
    {"file":"__tests__/putawayQueueService.test.ts","test":"getWalkPutaways > leaves the assigned bin null for a row that has none","proves":["A1","A2"]},
    {"file":"__tests__/putawayQueueService.test.ts","test":"getWalkPutaways (the query) > asks for assigned lines and overflow lines awaiting confirmation, oldest first","proves":["A2"]},
    {"file":"__tests__/putawayQueueService.test.ts","test":"getWalkPutaways (the query) > maps the status onto the row, so a confirm stop can be told from an assigned one","proves":["A2"]},
    {"file":"__tests__/putawayQueueService.test.ts","test":"getWalkPutaways (the query) > carries unit_load onto the row, so a pallet is not read as a confirm stop","proves":["A2"]},
    {"file":"__tests__/putawayQueueService.test.ts","test":"getWalkPutaways (the query) > throws on a query error rather than returning an empty walk","proves":["A2"]},
    {"file":"__tests__/putawayQueueService.test.ts","test":"getWalkPutaways (the query) > each product's live home (NX-0033) > reads the homes of every product on the walk in ONE batched read","proves":["A4"]},
    {"file":"__tests__/putawayQueueService.test.ts","test":"getWalkPutaways (the query) > each product's live home (NX-0033) > puts each product's current home on its rows, and null where it has none","proves":["A4"]},
    {"file":"__tests__/putawayQueueService.test.ts","test":"getWalkPutaways (the query) > each product's live home (NX-0033) > does not read homes for an empty walk","proves":["A4"]},
    {"file":"__tests__/putawayQueueService.test.ts","test":"getWalkPutaways (the query) > each product's live home (NX-0033) > throws when the homes cannot be read, rather than offering a home to a homed product","proves":["A4"]},
    {"file":"__tests__/putawayStopCardGiveHome.test.tsx","test":"putaway walk card — a product with no home > offers a Manager \"This product has no home bin. Give it one?\"","proves":["A4"]},
    {"file":"__tests__/putawayStopCardGiveHome.test.tsx","test":"putaway walk card — a product with no home > offers it on a desk-tagged line whose product has no home now: a desk-redirected line","proves":["A4"]},
    {"file":"__tests__/putawayStopCardGiveHome.test.tsx","test":"putaway walk card — a product with no home > offers it on a null-tagged line whose product has no home now: a line with no recorded source","proves":["A4"]},
    {"file":"__tests__/putawayStopCardGiveHome.test.tsx","test":"putaway walk card — a product with no home > offers it on a home-tagged line whose product has no home now: a line whose home has since been removed","proves":["A4"]},
    {"file":"__tests__/putawayStopCardGiveHome.test.tsx","test":"putaway walk card — a product with no home > stops offering when the walk refreshes and the product has a home (set at the desk, or by a sibling)","proves":["A4"]},
    {"file":"__tests__/putawayStopCardGiveHome.test.tsx","test":"putaway walk card — a product with no home > offers it on the identify step as well as the bin step, and not at the count","proves":["A4"]},
    {"file":"__tests__/putawayStopCardGiveHome.test.tsx","test":"putaway walk card — a product with no home > \"Not now\" keeps the engine bin and sends no make_home","proves":["A4"]},
    {"file":"__tests__/putawayStopCardGiveHome.test.tsx","test":"putaway walk card — a product with no home > closing the chooser without choosing brings the offer back","proves":["A4"]},
    {"file":"__tests__/putawayStopCardGiveHome.test.tsx","test":"putaway walk card — a product with no home > asks for the bins with the stop's own line, so its reservation does not count","proves":["A4"]},
    {"file":"__tests__/putawayStopCardGiveHome.test.tsx","test":"putaway walk card — a product with no home > choosing a home retargets the stop and sends make_home with a scan of that bin","proves":["A4"]},
    {"file":"__tests__/putawayStopCardGiveHome.test.tsx","test":"putaway walk card — a product with no home > puts the focus on the scan field of the stop once a home is chosen, so the gun can scan","proves":["A4"]},
    {"file":"__tests__/putawayStopCardGiveHome.test.tsx","test":"putaway walk card — a product with no home > sends the scan of the chosen bin as the manager typed it","proves":["A4"]},
    {"file":"__tests__/putawayStopCardGiveHome.test.tsx","test":"putaway walk card — a product with no home > says so when someone set a home for the product meanwhile and it was placed anyway","proves":["A4"]},
    {"file":"__tests__/putawayStopCardGiveHome.test.tsx","test":"putaway walk card — a product with no home > keeps the stop open with the server's words when the home was set meanwhile","proves":["A4"]},
    {"file":"__tests__/putawayStopCardGiveHome.test.tsx","test":"putaway walk card — a product with no home > cancelling the stop after choosing leaves nothing behind","proves":["A4"]},
    {"file":"__tests__/putawayStopCardOverflow.test.tsx","test":"putaway walk card — overflow awaiting confirmation > shows \"Home full — put in <bin>?\" and asks to scan that bin to confirm","proves":["A2"]},
    {"file":"__tests__/putawayStopCardOverflow.test.tsx","test":"putaway walk card — overflow awaiting confirmation > says it is a decision on the collapsed row too","proves":["A2"]},
    {"file":"__tests__/putawayStopCardOverflow.test.tsx","test":"putaway walk card — overflow awaiting confirmation > scanning the suggested bin confirms it, then moves on to the count","proves":["A2"]},
    {"file":"__tests__/putawayStopCardOverflow.test.tsx","test":"putaway walk card — overflow awaiting confirmation > accepts the suggested bin however it is typed","proves":["A2"]},
    {"file":"__tests__/putawayStopCardOverflow.test.tsx","test":"putaway walk card — overflow awaiting confirmation > another bin is refused at the scan and nothing is sent","proves":["A2"]},
    {"file":"__tests__/putawayStopCardOverflow.test.tsx","test":"putaway walk card — overflow awaiting confirmation > shows the server's refusal and refreshes the walk when the desk got there first","proves":["A2"]},
    {"file":"__tests__/putawayStopCardOverflow.test.tsx","test":"putaway walk card — overflow awaiting confirmation > stays on the bin step after a refusal so the refreshed stop can be scanned","proves":["A2"]},
    {"file":"__tests__/putawayStopCardOverflow.test.tsx","test":"putaway walk card — overflow awaiting confirmation > hides \"Put it back on the queue\" until confirmed","proves":["A2"]},
    {"file":"__tests__/putawayStopCardOverflow.test.tsx","test":"putaway walk card — overflow awaiting confirmation > hides \"Break down\" on a pallet until confirmed","proves":["A2"]},
    {"file":"__tests__/putawayWalkConfirmStops.test.tsx","test":"PutawayWalkView — overflow lines awaiting confirmation > lists an overflow line awaiting confirmation at its suggested bin","proves":["A2"]},
    {"file":"__tests__/putawayWalkConfirmStops.test.tsx","test":"PutawayWalkView — overflow lines awaiting confirmation > finds the suggested bin in the bin list when there is no route","proves":["A2"]},
    {"file":"__tests__/putawayWalkConfirmStops.test.tsx","test":"PutawayWalkView — overflow lines awaiting confirmation > does not mark a single-product pallet, which never waits for confirmation","proves":["A2"]},
    {"file":"__tests__/putawayWalkConfirmStops.test.tsx","test":"PutawayWalkView — overflow lines awaiting confirmation > does not mark a plain assigned stop","proves":["A2"]},
    {"file":"__tests__/putawayWalkConfirmStops.test.tsx","test":"PutawayWalkView — overflow lines awaiting confirmation > marks only the stop that needs confirming when both kinds are listed","proves":["A2"]},
    {"file":"__tests__/putawayWalkConfirmStops.test.tsx","test":"PutawayWalkView — overflow lines awaiting confirmation > finds the stop when its suggested bin is scanned","proves":["A2"]},
    {"file":"__tests__/putawayWalkConfirmStops.test.tsx","test":"PutawayWalkView — overflow lines awaiting confirmation > does not find the stop by a bin it is not at","proves":["A2"]},
    {"file":"__tests__/putawayWalkConfirmStops.test.tsx","test":"PutawayWalkView — overflow lines awaiting confirmation > tells an empty walk where the lines that need a decision are","proves":["A2"]},
    {"file":"__tests__/putawayWalkConfirmStops.test.tsx","test":"PutawayWalkView — the give-a-home offer reaches the stop card > offers a Manager or Admin the chance to give the product a home","proves":["A4"]},
    {"file":"__tests__/putawayWalkConfirmStops.test.tsx","test":"PutawayWalkView — the give-a-home offer reaches the stop card > offers a Warehouse user nothing","proves":["A4","A5"]},
    {"file":"__tests__/putawayWalkConfirmStops.test.tsx","test":"PutawayWalkView — the give-a-home offer reaches the stop card > offers nothing by default, when the page does not say the user may","proves":["A4"]},
    {"file":"__tests__/putawayWalkConfirmStops.test.tsx","test":"PutawayWalkView — the give-a-home offer reaches the stop card > offers nothing for a product that already has a home","proves":["A4"]},
    {"file":"__tests__/putawayWalkConfirmStops.test.tsx","test":"PutawayRow — the Assign queue > marks an overflow line Home full","proves":["A2"]},
    {"file":"__tests__/recommendPutawayService.test.ts","test":"confirmOverflowPutaway > sends decision confirm_overflow with the scanned bin's id","proves":["A2"]},
    {"file":"__tests__/recommendPutawayService.test.ts","test":"confirmOverflowPutaway > throws the server's words on a refusal","proves":["A2"]},
    {"file":"__tests__/recommendPutawayService.test.ts","test":"confirmOverflowPutaway > falls back to a plain sentence when the failure carried no body","proves":["A2"]},
    {"file":"__tests__/walkStops.test.ts","test":"isOverflowConfirmStop > is true only for a suggested overflow line with a bin","proves":["A2"]},
    {"file":"__tests__/walkStops.test.ts","test":"isOverflowConfirmStop > is false once the line is assigned, even if it began as overflow","proves":["A2"]},
    {"file":"__tests__/walkStops.test.ts","test":"isOverflowConfirmStop > is false for a suggested line that is not overflow","proves":["A2"]},
    {"file":"__tests__/walkStops.test.ts","test":"isOverflowConfirmStop > is false for a suggested overflow line with no bin to confirm","proves":["A2"]},
    {"file":"__tests__/walkStops.test.ts","test":"isOverflowConfirmStop > is false for a single-product pallet: a unit load never waits for confirmation (C5)","proves":["A2"]},
    {"file":"__tests__/walkStops.test.ts","test":"walkBinId > is the assigned bin, else the suggested one","proves":["A2"]},
    {"file":"__tests__/walkStops.test.ts","test":"walkBinId > is null when the line has neither","proves":["A2"]},
    {"file":"__tests__/walkStops.test.ts","test":"overflowConfirmCopy > is the plan copy table, verbatim, with the bin code filled in","proves":["A2"]},
    {"file":"__tests__/walkStops.test.ts","test":"homeTargetCopy > is the plan copy table, verbatim, with the bin and the product filled in","proves":["A4"]},
    {"file":"__tests__/wie/homeBinHealth.test.ts","test":"homeBinCandidateFactsFromRow > maps the shared columns like a home, and adds the bin name and the other homes","proves":["A4"]},
    {"file":"__tests__/wie/homeBinHealth.test.ts","test":"homeBinCandidateFactsFromRow > reads a blank name as null and a blank list of homes as none","proves":["A4"]},
    {"file":"__tests__/wie/homeBinHealth.test.ts","test":"homeChoiceRefusal > names the other product's home first, then the first problem, else null","proves":["A4"]},
    {"file":"__tests__/wie/homeBinHealth.test.ts","test":"homeBinChoices > keeps only bins with no problems that are not another product's home, by code","proves":["A4"]},
    {"file":"__tests__/wie/homeBinHealth.test.ts","test":"homeBinChoices > lists the bins in code order, whatever order the facts came in","proves":["A4"]},
    {"file":"__tests__/wie/homeBinHealth.test.ts","test":"homeBinChoices > is empty when no bin qualifies, and for no facts at all","proves":["A4"]},
    {"file":"__tests__/wie/homeBinHealth.test.ts","test":"homeBinChoices > does not change the list it is given","proves":["A4"]},
    {"file":"__tests__/wie/homeFirst.test.ts","test":"goesStraightToWalk > home, engine and a unit load go straight to the walk; a loose overflow line and a line with no bin do not","proves":["A1","A3"]},
    {"file":"__tests__/wie/putawayTasks.test.ts","test":"generatePutawayTasks — straight to the walk (NX-0033) > a line to a home with room is written assigned to the home, with no assigner","proves":["A1"]},
    {"file":"__tests__/wie/putawayTasks.test.ts","test":"generatePutawayTasks — straight to the walk (NX-0033) > a loose overflow line is written suggested, with no assigned bin","proves":["A2"]},
    {"file":"__tests__/wie/putawayTasks.test.ts","test":"generatePutawayTasks — straight to the walk (NX-0033) > a line for a product with no home is written assigned to the engine bin","proves":["A3"]},
    {"file":"__tests__/wie/putawayTasks.test.ts","test":"generatePutawayTasks — straight to the walk (NX-0033) > a single-product pallet is written assigned even though its source is overflow","proves":["A3"]},
    {"file":"__tests__/wie/putawayTasks.test.ts","test":"generatePutawayTasks — straight to the walk (NX-0033) > a residual with no eligible bin stays suggested","proves":["A2"]},
    {"file":"__tests__/wie/putawayTasks.test.ts","test":"generatePutawayTasks — straight to the walk (NX-0033) > reports assignedLocationId on each result, null for a line that waits","proves":["A1"]},
    {"file":"__tests__/wie/putawayTasks.test.ts","test":"generatePutawayTasks — a quarantined line (NX-0033 I1) > of a homed product goes straight to the walk at its hold bin, not as an overflow line","proves":["A11"]},
    {"file":"__tests__/wie/putawayTasks.test.ts","test":"generatePutawayTasks — a quarantined line (NX-0033 I1) > of a product with no home is not offered as the place to make a home","proves":["A11"]},
    {"file":"__tests__/putawayCompletion.test.ts","test":"heldLineHomeRefusal > refuses make_home on a held line with CONFLICT and the fixed copy","proves":["A11"]},
    {"file":"__tests__/holdBins.test.ts","test":"binIsHold > is true for a bin under a hold zone, false under an ordinary zone or none","proves":["A11"]},
    {"file":"__tests__/holdBins.test.ts","test":"binIsHold > fails closed: a read error throws rather than answering \"not held\"","proves":["A11"]},
    {"file":"__tests__/holdBins.test.ts","test":"anyLineHeld > is true when any line is headed for a hold bin","proves":["A11"]},
    {"file":"__tests__/recommendPutawayService.test.ts","test":"confirmOverflowPutaway > sends the scanned bin code as chosen_location_code, for the server to resolve (M1)","proves":["A2"]},
    {"file":"__tests__/homeChoiceScope.test.ts","test":"recommendationScopeRefusal > refuses a line that does not exist, of another product, or at another warehouse","proves":["A4"]},
    {"file":"__tests__/homeChoiceScope.test.ts","test":"recommendationScopeRefusal > refuses a line that is no longer open","proves":["A4"]}
  ],
  "allow": []
}
```

## Goal

After NX-0032, every received putaway line still lands in the Assign queue as `suggested`, and someone has to press Assign before it reaches the Walk. The owner's words: "the location assignment must be automatic, and the only time it should require human intervention is if the home location is full and you want to confirm the suggested overflow location."

This change makes that so, for every product and every warehouse:
- A line whose home has room, a line for a product with no home, and a single-product pallet are created already assigned and go straight onto the Walk. Nobody presses Assign.
- A loose line sent to overflow because the home is full waits for one confirmation. The desk (Assign, or Choose bin) or the walker (scanning the suggested bin on the Walk) can give it. The first one wins and the line leaves the other list.
- On a walk stop for a product with no home, a Manager or Admin can give the product a home by scanning, typing or picking from a list of bins that pass the home-bin health rules. The server refuses anyone else.
- The Bin detail panel on Warehouse setup scrolls with the mouse wheel.

## Approach

**Files.**

| File | Change |
|---|---|
| `supabase/functions/_shared/wie/homeFirst.ts`, `_shared/putawayTasks.ts` | `goesStraightToWalk` (pure routing rule). Tasks are written with `status` and `assigned_*` per that rule, and report `assignedLocationId`. |
| `supabase/migrations/00143_putaway_straight_to_walk.sql` | New `wie_confirm_overflow_tx` and `wie_home_bin_candidate_facts`. Redefined `wie_decide_putaway_tx` and `wie_putaway_stops`. |
| `supabase/migrations/00144_home_bin_candidate_exclude.sql` | `wie_home_bin_candidate_facts` takes `p_exclude_rec_ids`, so a line's own reservation is not counted against its bin when that bin is offered as a home or checked for `make_home`. |
| `supabase/migrations/00145_putaway_confirm_tightening.sql` | Redefined `wie_confirm_overflow_tx` and `wie_putaway_stops`: a single-product pallet is never a confirm stop, and the confirm refuses an inactive bin and an older layout in the desk's words. |
| `supabase/migrations/00146_home_rule_hold_exempt.sql` | Redefined `wie_home_block`: a putaway into a hold bin is not held to the home (final review I1). |
| `_shared/wie/homeBinHealth.ts`, `_shared/homeBinHealthLoad.ts`, new `home-bin-choices` function, `config/moduleOwnership.mjs` | The pure rule for which bins can be a home, its loaders, and a read-only function that feeds the chooser. |
| `_shared/putawayCompletion.ts`, `complete-putaway`, `decide-putaway` | The role gate and fitness check on `make_home`. `confirm_overflow`. Place now on system-assigned rows. |
| `services/supabase/*`, `hooks/queries/*` | `getWalkPutaways`, `confirmOverflowPutaway`, `getHomeBinChoices` and their hooks. |
| `components/inventory/putaway/walkStops.ts`, `GiveHomeSheet.tsx`, `GiveHomeOffer.tsx`, `PutawayStopCard.tsx` (with `StopCollapsedRow.tsx`, `StopDestination.tsx`, `StopProgressRail.tsx` split out of it), `PutawayWalkView.tsx`, `PutawayQueuePage.tsx`, `PutawayRow.tsx` | Confirm stops on the Walk, the `Home full` badge in the queue, the give-home offer and chooser. |
| `components/inventory/warehouse/FloatingPanel.tsx` | The scroll fix. |
| `__tests__/**`, `tests/e2e/rack-levels/*` | Unit, component, integration (dev) and Playwright (dev) proof. |
| `docs/claude/warehouse-stock-ops.md` | An NX-0033 paragraph. |

**Rulings, one line each.**
- **R2.** "Needs confirmation" is the row predicate `status='suggested' AND suggestion_source='overflow' AND recommended_location_id IS NOT NULL AND NOT unit_load`, so overflow lines already in the Assign queue also appear on the Walk as confirm stops, and no other existing row changes lists.
- **R3.** A loose overflow line always waits for confirmation, including one sent to overflow because its home is unusable. A unit-load pallet goes straight to the Walk whatever its source, and never waits for confirmation, even when it is put back on the queue (migration 00145).
- **R4.** `wie_decide_putaway_tx` (accept and override, not assign-only) also acts on a row that is `assigned` with `assigned_by IS NULL`, so the receive card and the opening-stock import still work. A redirect still needs `suggested`.
- **R5.** The home is set at completion, in the same transaction as the move, through the existing `make_home` path. It is not set when the manager picks the bin, so "Not now" or an abandoned stop leaves nothing behind.
- **R6.** The walk confirmation is the new compare-and-set function `wie_confirm_overflow_tx`, reached through `decide-putaway` `decision:'confirm_overflow'`. It takes the row lock the desk's Assign takes, accepts only the suggested bin, and refuses a stale scan.
- **R7.** The reason rule follows the status: an auto-assigned line placed in another bay is recorded without a reason, like any assigned walk line. The NX-0032 home rule still refuses an off-home bin while the home has room.
- **R8.** The wheel cause is `FloatingPanel`'s unbounded scroll body inside an `overflow-hidden` wrapper, to be confirmed in a browser before the fix. The fix goes in `FloatingPanel`, so the Locations tree is fixed too.

**Proof.** Unit tests cover the routing rule, the role gate and the walk stops. Integration tests on dev cover the SQL rules (A1 to A3, A6, A7), the functions over HTTP, and a two-connection race. One Playwright spec on dev covers A9 and a second covers the wheel. `failFirst` was empty in the first commit because check:brief cannot run a test that is not written yet. One brief-only revision names the unit and component tests that fail on the base, by assertion or because the module they test is new; the SQL, the functions over HTTP and the browser are `manual` and proven on dev.

## Out of scope

- Measuring cartons or setting real capacities, and home-bin maximum editing (it exists).
- Loose-carton tracking: a barcode per unit of measure, open cartons, "cartons + packets" wording and open-first reservation. That is its own brief.
- Changing which bin the engine picks.
- Changing an existing home from the Walk. That stays in the home-bin editor.
- Any client tenant, and any data step on any tenant. This branch is migrated and deployed to dev only, and nothing is pushed or released without the owner.

## FINAL

Re-verified after the final-review fixes at `fc3b8de`: `npx tsc --noEmit`, `npm run check:edge-types` (86 functions clean), `npm run lint`, `npm run check:overlays`, `npm run build` and `npx vitest run` (418 files, 6598 tests) pass. Migration 00146 is applied on dev. The functions changed by the fixes are NOT yet redeployed to dev, so the HTTP cases added for them have not run; until then A10 is not claimed. The earlier evidence below was gathered at `b7876e7`.

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `generatePutawayTasks — straight to the walk (NX-0033) > a line to a home with room is written assigned to the home, with no assigner` and `goesStraightToWalk > home, engine and a unit load go straight to the walk; a loose overflow line and a line with no bin do not` fail on the base and pass on the tip (check:brief). `npm run test:integration -- putawayStraightToWalk` on dev: `recommend-putaway for a homed product with room creates an assigned task to the home with no assigner` passed, file 36 of 36. Playwright step 1 (homed product on the Walk, not in the Assign queue) green. | |
| A2 | claimed | `isOverflowConfirmStop > is true only for a suggested overflow line with a bin`, `PutawayWalkView — overflow lines awaiting confirmation > lists an overflow line awaiting confirmation at its suggested bin`, `putaway walk card — overflow awaiting confirmation > scanning the suggested bin confirms it, then moves on to the count` and `... > another bin is refused at the scan and nothing is sent` fail on the base and pass on the tip. On dev: `wie_confirm_overflow_tx assigns an overflow line to its suggested bin, assigned_by the worker`, `refuses a bin other than the suggested one, naming the current one`, `refuses a single-product pallet (a unit load never waits for confirmation)`, `wie_putaway_stops does not list a suggested unit-load pallet as a confirm stop`, and over HTTP `decide-putaway confirm_overflow from a Warehouse user at its own site assigns; a second confirm is CONFLICT`. Playwright steps 2 and 3 green. | A desk redirect that lands before the walk scan is refused with "no longer waits for an overflow confirmation" and not "the suggested bin is now X", because a redirect changes the line's source. Safe either way: nothing is assigned. |
| A3 | claimed | `generatePutawayTasks — straight to the walk (NX-0033) > a line for a product with no home is written assigned to the engine bin` and `... > a single-product pallet is written assigned even though its source is overflow` fail on the base and pass on the tip. On dev over HTTP: `recommend-putaway for a product with no home creates an assigned task to the engine bin` and `recommend-putaway for a single-product pallet creates an assigned task (C5)` passed. | |
| A4 | claimed | `GiveHomeSheet > picking from the dropdown and pressing Make this its home chooses it`, `putaway walk card — a product with no home > choosing a home retargets the stop and sends make_home with a scan of that bin`, `... > keeps the stop open with the server's words when the home was set meanwhile`, `homeBinChoices > keeps only bins with no problems that are not another product's home, by code` and `loadHomeChoiceRefusal > names the other product when the bin is already somebody else's home` fail on the base and pass on the tip. On dev: `a bin with room for exactly the line is offered as a home, and make_home onto it is accepted`, and over HTTP `complete-putaway refuses make_home from a Manager into a bin that cannot be a home, and moves nothing` and `home-bin-choices gives a Manager only fit bins and a Warehouse user FORBIDDEN`. Playwright step 4 green: home given by scan, by typing and by the dropdown. | The Manager is driven as an Admin login in the browser (ruling R9); the Manager role itself is proven over HTTP with a made-up Manager user. |
| A5 | claimed | `decidePutawayCompletion > make_home is refused for a Warehouse user even when the product has no home`, `canSetHome > only Admin and Manager`, `PutawayQueuePage — who is offered "give it a home" > Warehouse -> canSetHome false` fail on the base and pass on the tip. On dev over HTTP: `complete-putaway refuses make_home from a Warehouse user with FORBIDDEN before reading the task` passed. Playwright step 5 green: no offer for a made-up Warehouse user, forged make_home refused. | |
| A6 | claimed | On dev, two connections, committed made-up data: `desk assign and walk confirm at once: exactly one wins, one row assigned, no stock moved`, `walk confirm waits for a desk assign holding the line: the desk keeps its bin, the walk is refused` and `walk complete and desk Place now at once move the stock exactly once` passed (file 36 of 36). | Proven on dev only. There is no unit test for it and none is possible offline. |
| A7 | claimed | `canPlaceNow > a suggested line, or one the system assigned and nobody touched` and `decisionActsOnStatus > place now (accept / override) also acts on a line the system assigned` fail on the base and pass on the tip. On dev: `Place now on a system-assigned line works; on a person-assigned line it is refused`, `a partial Place now on a system-assigned line leaves the remainder assigned on the walk`, and over HTTP `decide-putaway accept on a system-assigned line is no longer refused as already assigned`. | The receive card and the opening-stock import were not driven in a browser. They share `wie_decide_putaway_tx`, proven above. The HTTP test passes the status gate and stops at the stock move because the made-up product has no stock. |
| A8 | claimed | `FloatingPanel > the body is bounded by its row, so it is the element that scrolls` fails by assertion on the base and passes on the tip. `bin-detail-wheel.spec.ts` against dev, in Chromium: red on the base, green on the tip (Task 10), and green again in three consecutive runs beside the story spec (6 of 6 each). | The Locations panel shares `FloatingPanel` and is fixed by the same change; only the Bin detail panel is driven in the browser. |
| A9 | claimed | `npx playwright test tests/e2e/rack-levels/putaway-straight-to-walk.spec.ts bin-detail-wheel.spec.ts --project=chromium` against dev: five story steps plus the wheel step, green in three consecutive runs (6 of 6 each). NX-0032's `putaway-home-block.spec.ts`, updated for assigned-on-receipt, green twice. Each spec's afterAll asserts nothing made-up remains on dev. | Each of the five story tests sets `test.setTimeout(240_000)` (`STORY_TIMEOUT`), the story length NX-0032's spec also uses; the default is 30 s. Nothing else was raised. The frontend was this branch served by a local vite on port 3033, with a CORS proxy kept outside the repo (see Not claimed). |
| A10 | not-claimed | | Migrations 00143 to 00146 are applied on dev (`npm run migrate:dev`; the 00146 RPC cases in `homeBinEnforced` and `putawayStraightToWalk` pass on dev). The earlier deploy of the ten functions predates the final-review fixes. complete-putaway, decide-putaway, home-bin-choices and every function that bundles `_shared/putawayTasks.ts` must be redeployed, with the owner's consent, before this is claimed. **Release order:** migrate 00143 to 00146, then deploy the functions, then the frontend, all built from a merge with origin/main. If the functions go first, new `assigned` lines are refused by the old `wie_decide_putaway_tx`, and `confirm_overflow` calls an RPC that does not exist. If the migrations go first, nothing breaks. |
| A11 | claimed | `generatePutawayTasks — a quarantined line (NX-0033 I1) > of a homed product goes straight to the walk at its hold bin, not as an overflow line` and `heldLineHomeRefusal > refuses make_home on a held line with CONFLICT and the fixed copy` fail on the base and pass on the tip. On dev (00146): `a putaway to a hold bin is not held to the home while the home has room (I1, 00146)` (homeBinEnforced, 35 of 35 RPC cases) and `a held overflow line is confirmed to its hold bin while the home has room (I1, 00146)` (putawayStraightToWalk, 23 of 23 RPC cases) pass. The hidden offer: `PutawayWalkView — the give-a-home offer reaches the stop card > offers nothing on a stop at a hold bin: a held line never makes a home (I1)` and `putaway walk card — a product with no home > offers nothing on a held line: its bin is a hold bin, never a home (I1)` were red on `b6cd602` and pass on the tip. | The HTTP cases (recommend-putaway with quarantine, complete-putaway make_home on a held line) are written but wait on the redeploy. The base has no give-home offer at all, so the hidden-offer tests cannot fail there and are not named fail-first. |

### Not claimed

- No browser walk on the RS35 handheld. The Walk was driven in desktop Chromium only.
- The Manager role is driven as an Admin login in the browser (R9) and proven for a Manager over HTTP only.
- The post-release check on the production tenant (spec section 7, last line) is the owner's and was not done. Nothing is pushed, released or deployed beyond dev.
- The Playwright runs used this branch's frontend served locally (vite on port 3033) against dev, not a deployed build. Dev's functions allow only `http://localhost:3000` and `:3001` as origins and both ports were held by another project, so a throwaway CORS proxy (kept outside the repo) forwarded to dev and presented the allowed origin. No repo or dev configuration changed. A deployed frontend was not exercised.
- Timeouts: the story spec's `test.setTimeout(240_000)` (five tests) is the only raised timeout. `check:brief` does not flag a `setTimeout` call, and `allow` is empty.
- Parked by the controller during the per-task reviews, none fixed here: (1) the home chooser does not page, so a warehouse with more than 1000 bins would get a truncated list; (2) the server does not refuse `complete-putaway` of a still-waiting overflow line into another bin, because only the walk card insists on the suggested bin; (3) two Managers choosing the same bin for two different homeless products within the same moment could both pass the fitness check, which runs outside the transaction; (4) fixed after the final review, see A11; (5) after a partial count on a stop whose home was just chosen, the remainder points at the engine's bin and the home rule steers the next scan, and after a refused `make_home` the card needs cancel and reopen; (6) `wie_confirm_overflow_tx` accepts a NULL actor, `wie_home_bin_candidate_facts` does not check that its first argument is a warehouse, and a few coverage gaps are listed in the local review notes (not in git).
- Final-review minors: M1 (the walk sends the scanned code; decide-putaway resolves it), M3 (home-bin-choices scopes `recommendationId`) and M5 (the "Home full" badge needs a bin) are fixed. M2 is not fixed: a partial Place now can shrink a walk card's line, and the stale card then records what is left without refusing. The dock only holds what is left, so nothing is over-moved.
- A held line that was written `overflow` before this fix (on any tenant where NX-0032 is live) still lists as a confirm stop with "Home full" in both lists. Confirming it now works (00146). No data step re-tags these rows.
- The walk tells a held stop from the zone tree (`lib/heldLocations.ts`: any hold ancestor). The server uses the nearest zone. The two disagree only for an ordinary zone nested inside a hold zone, where the walk hides an offer the server would allow.
- Existing overflow lines already in the Assign queue at release time also appear on the Walk as confirm stops (ruling R2). That is intended, and it is not rehearsed against real data here.
