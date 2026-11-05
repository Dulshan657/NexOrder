# NX-0027 — A customer tab the office can work from

```json brief
{
  "id": "NX-0027-customer-tab",
  "base": "3a75041fbce594938562f03f706724f5f9e8fdb5",
  "approved": "2026-11-05 owner",
  "acceptance": [
    { "id": "A1", "check": "The HoReCa tab opens on a Details view showing each customer's contact, phone, email, address, ABN and brands." },
    { "id": "A2", "check": "A toggle switches to a Sales view with Tier, Segment, Credit Limit, Last Order and Outstanding, and back. Both views work with Field Ops on or off." },
    { "id": "A3", "check": "A brand filter lists the brands found on the customers, with no brand written in code, and shows only that brand's buyers." },
    { "id": "A4", "check": "A missing details filter shows customers with no phone, email or contact, or whose address is blank or the 'Address needed' placeholder. A missing ABN alone does not count." },
    { "id": "A5", "check": "In the Details view a missing value reads as missing, and 'Address needed' is never shown as if it were an address." },
    { "id": "A6", "check": "The Admin sidebar shows HoReCa under its own Customers heading, not under Field Ops, with Field Ops on or off." },
    { "id": "A7", "check": "Merged, deployed to dev and walked at 200 customers: search, both views, both filters, edit and save.", "manual": "deploy:dev and a browser walk on made-up customers" },
    { "id": "A8", "check": "Released to the client tenant and walked as Admin, without changing customer data.", "manual": "release runbook and a browser walk; /version.json shows the release" }
  ],
  "failFirst": [
    { "file": "__tests__/hoReCaListViews.test.tsx", "test": "customer tab views > opens on the details view with contact, phone, email, address, ABN and brands", "proves": ["A1"] },
    { "file": "__tests__/hoReCaListViews.test.tsx", "test": "customer tab views > switches to the sales columns and back", "proves": ["A2"] },
    { "file": "__tests__/hoReCaListViews.test.tsx", "test": "customer tab views > filters to one brand's buyers from the brands on the customers", "proves": ["A3"] },
    { "file": "__tests__/hoReCaListViews.test.tsx", "test": "customer tab views > filters to customers with missing details", "proves": ["A4"] },
    { "file": "__tests__/hoReCaListViews.test.tsx", "test": "customer tab views > shows a missing value and the address placeholder as missing", "proves": ["A5"] },
    { "file": "__tests__/horecaListFilters.test.ts", "test": "customer list filters > counts a blank value or the address placeholder as missing but not a missing ABN", "proves": ["A4"] },
    { "file": "__tests__/horecaListFilters.test.ts", "test": "customer list filters > lists each brand once, sorted, ignoring case and spacing", "proves": ["A3"] },
    { "file": "__tests__/appShellSidebarLayout.test.ts", "test": "customer tab nav > puts HoReCa under its own Customers heading outside Field Ops", "proves": ["A6"] }
  ],
  "allow": []
}
```

## Goal

The office needs to look customers up, find who buys a brand and work through missing details. The existing tab shows sales figures only, and contact details are visible only in the edit form. A client that invoices elsewhere has no use for those figures. The owner chose to improve this tab rather than add a second one.

## Approach

`components/HoReCaListView.tsx` gains a Details and Sales toggle, Details first, plus brand and missing details filters. Pure rules live in a new `lib/horecaListFilters.ts`. `components/AppShell.tsx` moves the sidebar item under a Customers heading. Search, the segment and tier filters, add, edit and delete keep working. No per-client code, schema or function change.

## Out of scope

Loading customers, CSV export, changing who may edit, pagination, and any change to the customer form or its validation.

## FINAL
