-- Fix misspelling: "Accoustic Music" → "Acoustic Music"
-- Updates both the event_types lookup table and any events referencing the old label.

UPDATE event_types
SET label = 'Acoustic Music'
WHERE label = 'Accoustic Music';

UPDATE events
SET event_type = 'Acoustic Music'
WHERE event_type = 'Accoustic Music';
