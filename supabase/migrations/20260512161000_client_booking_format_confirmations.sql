-- Apply client-confirmed event booking formats from:
-- /Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/Barons Seating Changes - Sheet1.csv
-- Generated from a live dry run on 2026-05-12.

with client_booking_formats(event_id, booking_type) as (
  values
    ('3168f3f8-8d68-4448-899d-cb76ad951e2a'::uuid, 'pay_on_arrival_seated'::text), -- row 49: 14/04/2026 19:00 Charity Pub Quiz | The Star, Malden Rushett
    ('95f552f5-4832-46a4-9348-fc41743ef00a'::uuid, 'pay_on_arrival_seated'::text), -- row 50: 14/04/2026 20:00 Charity Pub Quiz
    ('f957a808-eeff-47f7-84c7-27a62ef965d1'::uuid, 'free_standing_unreserved'::text), -- row 51: 18/04/2026 20:30 Band Night: Chase The Tail | The Horseshoe, Warlingham
    ('3b492912-ad37-457d-9160-b60b3f53dce6'::uuid, 'pay_on_arrival_seated'::text), -- row 52: 20/04/2026 20:00 Charity Quiz Night: 20 April
    ('134f65d7-77b4-4f59-828e-544831022908'::uuid, 'free_seated'::text), -- row 53: 27/04/2026 19:30 Jazz Night at The Cricketers - Monday 27 April
    ('1270c9c6-7c21-481b-83ee-8f664655d89a'::uuid, 'pay_on_arrival_seated'::text), -- row 54: 28/04/2026 19:00 Charity Pub Quiz | The Star, Malden Rushett
    ('ff4743d4-5793-4678-87e8-cd9fafb134d2'::uuid, 'pay_on_arrival_seated'::text), -- row 55: 28/04/2026 20:00 Charity Pub Quiz
    ('267ff3c6-948d-4a90-8af6-429d2b77b43a'::uuid, 'pay_on_arrival_seated'::text), -- row 59: 12/05/2026 19:00 Charity Pub Quiz | The Star, Malden Rushett
    ('b9abb07e-3693-466e-a706-bb45973b718d'::uuid, 'pay_on_arrival_seated'::text), -- row 60: 12/05/2026 20:00 Charity Pub Quiz
    ('39e31e2d-f57e-4735-a94f-ea061e9f2f3a'::uuid, 'free_seated'::text), -- row 61: 15/05/2026 19:30 Amy Winehouse Tribute | The Star, Malden Rushett
    ('568e0f3d-3e74-408a-bcad-2c33caa31066'::uuid, 'free_standing_unreserved'::text), -- row 62: 15/05/2026 20:30 Tequila Chase - Band Night | Meade Hall
    ('698ff013-7b1c-4c33-bbe9-cb7f17271fda'::uuid, 'free_standing_unreserved'::text), -- row 63: 16/05/2026 20:45 Band Night: Something Else | The Horseshoe, Warlingham
    ('127bbe76-d1ea-4f89-9917-6add0e8fba3f'::uuid, 'free_seated'::text), -- row 64: 18/05/2026 19:30 Jazz Night at The Cricketers - Monday 18 May
    ('bf5bab2c-d36c-489b-b6c2-20bec1c4cf3a'::uuid, 'pay_on_arrival_seated'::text), -- row 65: 18/05/2026 20:00 Charity Quiz Night: 18 May
    ('1d8b1c1d-de9e-4e07-8de5-bc86220f8db0'::uuid, 'pay_on_arrival_seated'::text), -- row 66: 19/05/2026 20:00 Quiz Night | The Shinfield Arms, Shinfield
    ('4da6a898-7117-4790-8d64-b31f6504f06b'::uuid, 'pay_on_arrival_seated'::text), -- row 67: 25/05/2026 20:00 Quiz Night | The Rose & Crown, Thorpe
    ('c329d7a9-2769-4d6a-a2d3-b4cb403fda25'::uuid, 'pay_on_arrival_seated'::text), -- row 68: 26/05/2026 19:00 Charity Pub Quiz | The Star, Malden Rushett
    ('23c6810a-aa31-4bd9-b09a-d96315975b49'::uuid, 'pay_on_arrival_seated'::text), -- row 69: 26/05/2026 20:00 Charity Pub Quiz
    ('60cdfe07-46cf-469e-b3fd-3e3cc34d534d'::uuid, 'pay_on_arrival_seated'::text), -- row 70: 28/05/2026 19:30 Drag Queen Music Bingo
    ('3ef87d56-3e82-4d2f-b777-5b2b9e91e29c'::uuid, 'free_seated'::text), -- row 71: 28/05/2026 19:30 Live Music: Hannah-Marie | The Curious Pig in the Parlour
    ('efc3e344-5183-4db7-a07a-a9aeec124496'::uuid, 'pay_on_arrival_seated'::text), -- row 72: 02/06/2026 20:00 Quiz Night | The Shinfield Arms, Shinfield
    ('bcbbd3f7-1855-4c02-8292-07c20edec39c'::uuid, 'pay_on_arrival_seated'::text), -- row 73: 03/06/2026 19:30 Charity Pub Quiz | Meade Hall at The Crown & Cushion
    ('63ba0f61-a330-4ea5-ab70-09d41d510397'::uuid, 'free_standing_unreserved'::text), -- row 74: 04/06/2026 20:00 The Congakeyz - FREE Live Music | Meade Hall
    ('b907dc70-307e-46e4-b52b-b8564f9d8f85'::uuid, 'free_standing_unreserved'::text), -- row 75: 05/06/2026 19:30 Surrey Soul Sensation | Meade Hall at The Crown & Cushion
    ('bd4b80ba-453c-4454-8ee8-0c5d56ed7cc9'::uuid, 'free_seated'::text), -- row 76: 08/06/2026 19:30 Live Music: Dan Olsen | The Cricketers, Horsell
    ('99045127-e3ba-48cd-b0af-10adeff635ab'::uuid, 'pay_on_arrival_seated'::text), -- row 77: 09/06/2026 19:00 Charity Pub Quiz | The Star, Malden Rushett
    ('c61b5b7d-fc97-4d4f-9e25-397a76e0eb32'::uuid, 'pay_on_arrival_seated'::text), -- row 78: 15/06/2026 20:00 Charity Quiz Night: 15 June
    ('9ba4f017-3620-4ad4-b72b-255eeb147243'::uuid, 'pay_on_arrival_seated'::text), -- row 79: 16/06/2026 20:00 Quiz Night | The Shinfield Arms, Shinfield
    ('8ff41452-be5e-46cd-b50c-0d7d6f6ae25c'::uuid, 'free_standing_unreserved'::text), -- row 80: 20/06/2026 20:30 Band Night: Randy and The Rockets | The Horseshoe, Warlingham
    ('bf9ce932-f53f-4b63-8c84-137d075752f8'::uuid, 'pay_on_arrival_seated'::text), -- row 81: 23/06/2026 19:00 Charity Pub Quiz | The Star, Malden Rushett
    ('ecb6efe2-6cd5-472f-8531-7d9eb6ef0419'::uuid, 'free_seated'::text), -- row 82: 25/06/2026 19:30 Live Music: Lily Cooper | The Curious Pig in the Parlour
    ('ca390c05-d7d8-4241-b8b4-a9795afcf1f9'::uuid, 'free_standing_unreserved'::text), -- row 83: 26/06/2026 20:00 Randy and The Rockets - Band Night | The Bletchingley Arms
    ('d728efb5-c150-40ce-bcd4-6c621b73ee2c'::uuid, 'free_seated'::text), -- row 84: 29/06/2026 19:30 Jazz Night at The Cricketers - Monday 29 June
    ('832f5c7e-b724-41cb-a400-1cc0ed6c179d'::uuid, 'pay_on_arrival_seated'::text), -- row 85: 30/06/2026 20:00 Quiz Night | The Shinfield Arms, Shinfield
    ('8de2fc50-c7b9-49cb-be68-100a5ecd4742'::uuid, 'paid_standing_unreserved'::text), -- row 86: 03/07/2026 20:00 Tom Jones Tribute night
    ('520cb651-ba42-41ae-b758-01b1b76729e3'::uuid, 'free_standing_unreserved'::text), -- row 87: 05/07/2026 16:00 DJ Darren Through the Decades Summer party
    ('a935d7a7-d46c-48c2-85c9-9483bb26462b'::uuid, 'pay_on_arrival_seated'::text), -- row 88: 07/07/2026 19:00 Charity Pub Quiz | The Star, Malden Rushett
    ('6d8dcf13-0d03-4018-b27b-289e8350bd74'::uuid, 'pay_on_arrival_seated'::text), -- row 89: 14/07/2026 20:00 Quiz Night | The Shinfield Arms, Shinfield
    ('1b8aa7bc-944d-4da4-983c-6f18e911d262'::uuid, 'free_standing_unreserved'::text), -- row 90: 18/07/2026 20:30 Band Night: The Fog | The Horseshoe, Warlingham
    ('db0bed0b-d643-40ff-bfed-f3636b0f1673'::uuid, 'pay_on_arrival_seated'::text), -- row 92: 20/07/2026 20:00 Charity Quiz Night: 20 July
    ('a99d0a87-9654-4bad-ab6b-30a3c7a1df67'::uuid, 'free_standing_unreserved'::text), -- row 93: 26/07/2026 15:00 Surrey Soul Sensation (Daytime) | Meade Hall at The Crown & Cushion
    ('87d23326-a342-4996-a931-0f13ef41971e'::uuid, 'free_seated'::text), -- row 94: 27/07/2026 19:30 Jazz Night at The Cricketers - Monday 27 July
    ('26d9c8aa-7190-422c-aeb4-1b5aa2ce0a3e'::uuid, 'pay_on_arrival_seated'::text), -- row 95: 28/07/2026 20:00 Quiz Night | The Shinfield Arms, Shinfield
    ('c3309b88-e06f-4e15-9a80-f28dc47a5ac1'::uuid, 'free_standing_unreserved'::text), -- row 96: 15/08/2026 20:30 Band Night: Something Else | The Horseshoe, Warlingham
    ('1fb65932-248c-46ce-90b9-d14583cc576d'::uuid, 'pay_on_arrival_seated'::text), -- row 97: 17/08/2026 20:00 Charity Quiz Night: 17 August
    ('6522ce63-1f4d-4303-acfb-cdb4ff244ed8'::uuid, 'free_standing_unreserved'::text), -- row 98: 21/08/2026 20:00 Randy and The Rockets - Band Night | The Bletchingley Arms
    ('acefd8f0-130a-485f-bf47-e2980244535a'::uuid, 'free_standing_unreserved'::text), -- row 99: 23/08/2026 16:00 DJ Darren Through the Decades Summer party
    ('a35f793b-0020-406f-a298-c2e4260a24d5'::uuid, 'free_seated'::text), -- row 100: 24/08/2026 19:30 Jazz Night at The Cricketers - Monday 24 August
    ('2a7ad731-8c92-4ffb-95cc-04b96cb3e58b'::uuid, 'free_standing_unreserved'::text), -- row 101: 19/09/2026 20:30 Band Night: Chase The Tail | The Horseshoe, Warlingham
    ('bb1d774c-8140-4e78-a534-5a40768bb3cc'::uuid, 'pay_on_arrival_seated'::text), -- row 102: 21/09/2026 20:00 Charity Quiz Night: 21 September
    ('4a4db125-3cca-495e-a673-2e47bdfe8c71'::uuid, 'free_seated'::text), -- row 103: 28/09/2026 19:30 Jazz Night at The Cricketers - Monday 28 September
    ('ff6f769d-4388-40e8-9665-f42dc7821520'::uuid, 'free_standing_unreserved'::text), -- row 104: 17/10/2026 20:30 Band Night: Randy and The Rockets | The Horseshoe, Warlingham
    ('8e364fa6-212b-4c9b-a818-c4ecff020043'::uuid, 'pay_on_arrival_seated'::text), -- row 105: 19/10/2026 20:00 Charity Quiz Night: 19 October
    ('2fff63d7-3506-4913-ae68-e2eb2d32254f'::uuid, 'paid_seated'::text), -- row 106: 26/10/2026 19:30 Jazz Night at The Cricketers - Monday 26 October
    ('5f3cfda6-b62f-47eb-869a-16f1b8dc279c'::uuid, 'free_standing_unreserved'::text), -- row 107: 14/11/2026 20:30 Band Night: Chase The Tail | The Horseshoe, Warlingham
    ('ce785f2a-d702-48c0-a39a-06a2a1f10c51'::uuid, 'pay_on_arrival_seated'::text), -- row 108: 16/11/2026 20:00 Charity Quiz Night: 16 November
    ('301f21f2-ad76-4c17-903f-4bb5551309bc'::uuid, 'free_seated'::text) -- row 109: 30/11/2026 19:30 Jazz Night at The Cricketers - Monday 30 November
)
update public.events as e
set
  booking_type = cbf.booking_type,
  ticket_price = case when cbf.booking_type in ('free_seated', 'free_standing', 'free_standing_unreserved') then null else e.ticket_price end,
  updated_at = timezone('utc', now())
from client_booking_formats as cbf
where e.id = cbf.event_id
  and e.deleted_at is null
  and e.booking_type is distinct from cbf.booking_type;
