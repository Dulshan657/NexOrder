-- Walk-in HoReCa support
--
-- When a sales rep adds an ad-hoc stop during a scheduled visit (a customer
-- who isn't in the master list), we create a lightweight HoReCa record
-- flagged is_temporary=TRUE so the office/CRM team can review it and
-- either promote it to a full record or merge it into an existing one.

ALTER TABLE public.horecas
    ADD COLUMN IF NOT EXISTS is_temporary        BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS created_by_user_id  UUID        REFERENCES public.profiles(id),
    ADD COLUMN IF NOT EXISTS reviewed_at         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reviewed_by         UUID        REFERENCES public.profiles(id);

-- Partial index speeds up the Walk-in Review tab (unreviewed temps only).
CREATE INDEX IF NOT EXISTS idx_horecas_unreviewed_temp
    ON public.horecas (created_at DESC)
    WHERE is_temporary = TRUE AND reviewed_at IS NULL;
