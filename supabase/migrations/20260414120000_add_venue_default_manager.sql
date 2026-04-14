-- Add default manager responsible to venues
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS default_manager_responsible TEXT;

ALTER TABLE public.venues
  ADD CONSTRAINT venues_default_manager_responsible_len
    CHECK (char_length(default_manager_responsible) <= 200);

NOTIFY pgrst, 'reload schema';
