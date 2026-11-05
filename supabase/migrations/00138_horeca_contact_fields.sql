-- =============================================================================
-- Customer contact person, phone, ABN, billing email and brand buyers (NX-0018)
-- Migration: 00138_horeca_contact_fields.sql
-- =============================================================================
-- Amadiya's customers need a contact person, a phone and an ABN on the record,
-- several of them share one billing mailbox, and the buyers of one supplier
-- brand must be identifiable. A customer row had
-- none of these.
--
--   contact_name   TEXT      who to ask for at the customer. Not an address's
--                            recipient_name (00021), which belongs to one
--                            delivery address, not to the account
--   phone          TEXT      as the customer gave it ("0400 000 001")
--   abn            TEXT      11 digits, spaces already stripped by mutate-horeca
--   billing_email  TEXT      where an invoice is addressed. NOT UNIQUE: venues
--                            in one group share an inbox, which is the reason
--                            this column exists
--   buys_brands    TEXT[]    brand names this customer buys ('McCURRIE'),
--                            matched by eye and by array contains, not by FK
--
-- THE EMAIL COLUMN IS NOT CALLED `email`. send-email reads `horecas.email` to
-- decide who receives an order confirmation, so a column of that name would be
-- mailed. Nothing reads `billing_email`: it is a record, not a recipient.
-- `contact_email` (00021) is the inbound PO sender match and is left alone.
--
-- Additive and safe. The four nullable columns start NULL; buys_brands is NOT
-- NULL DEFAULT '{}', so every existing row reads as "buys no tracked brand".
-- No index: nothing filters on these yet.
--
-- Writes: the ABN shape (11 digits, spaces ignored) is checked in
-- mutate-horeca, the only writer of `horecas` (locked in 00013). There is no
-- CHECK here, so a bulk load by the service role is not stopped by one odd ABN
-- in a spreadsheet; the load has to validate its own input.
--
-- Grants and RLS are untouched. A new column inherits the table's existing
-- grants, so config/lockedTables.mjs and config/grantBaseline.mjs need no
-- change. Reads are as before: staff see every row, a customer only their own
-- venue (00129).
--
-- Idempotent.
-- =============================================================================

BEGIN;

ALTER TABLE public.horecas
    ADD COLUMN IF NOT EXISTS contact_name  TEXT,
    ADD COLUMN IF NOT EXISTS phone         TEXT,
    ADD COLUMN IF NOT EXISTS abn           TEXT,
    ADD COLUMN IF NOT EXISTS billing_email TEXT,
    ADD COLUMN IF NOT EXISTS buys_brands   TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.horecas.contact_name IS
    'The person to ask for at this customer. Free text. Mutated only via mutate-horeca (NX-0018).';
COMMENT ON COLUMN public.horecas.phone IS
    'Customer phone as entered. Free text. Mutated only via mutate-horeca (NX-0018).';
COMMENT ON COLUMN public.horecas.abn IS
    'Australian Business Number, 11 digits with no spaces. Shape checked by mutate-horeca (NX-0018).';
COMMENT ON COLUMN public.horecas.billing_email IS
    'Where this customer''s invoices are addressed. Shared by design: several customers may hold the same address. '
    'Never used as a recipient by send-email, which reads horecas.email (NX-0018).';
COMMENT ON COLUMN public.horecas.buys_brands IS
    'Supplier brands this customer buys, e.g. {McCURRIE}. Free text, not a foreign key (NX-0018).';

COMMIT;
