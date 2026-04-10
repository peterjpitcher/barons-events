-- Seed planning items from the 2026-2027 hospitality marketing calendar.
-- April 2026 through March 2027.
-- All dates verified via authoritative sources (April 2026).
-- Tags in description use: [Post] [Campaign] [Upselling] [Internal] [LinkedIn]

DO $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Use the first central_planner as the creator
  SELECT id INTO v_user_id
    FROM public.users
   WHERE role = 'central_planner'
   ORDER BY created_at
   LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No central_planner user found — cannot seed planning items';
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- APRIL 2026 — Easter & Sustainability
  -- ═══════════════════════════════════════════════════════════════════════════

  INSERT INTO planning_items (title, description, type_label, target_date, status, created_by) VALUES
  ('Stress Awareness Month (Staff wellbeing)', 'All month. [Internal]', 'Internal', '2026-04-01', 'planned', v_user_id),
  ('International Fun at Work Day', '[Internal] [LinkedIn]', 'Internal', '2026-04-01', 'planned', v_user_id),
  ('Good Friday (Bank Holiday)', 'Bank Holiday.', 'Occasion', '2026-04-03', 'planned', v_user_id),
  ('Easter Sunday', NULL, 'Occasion', '2026-04-05', 'planned', v_user_id),
  ('Easter Monday (Bank Holiday)', 'Bank Holiday.', 'Occasion', '2026-04-06', 'planned', v_user_id),
  ('National Beer Day', '[Post] [Upselling]', 'Post', '2026-04-07', 'planned', v_user_id),
  ('International Moment of Laughter Day', '[Internal]', 'Internal', '2026-04-14', 'planned', v_user_id),
  ('National Eggs Benedict Day', NULL, 'Occasion', '2026-04-16', 'planned', v_user_id),
  ('Malbec World Day', '[Post] [Campaign] [Upselling]', 'Campaign', '2026-04-17', 'planned', v_user_id),
  ('National Tea Day', '[Post]', 'Post', '2026-04-21', 'planned', v_user_id),
  ('St. George''s Day', '[Campaign]', 'Campaign', '2026-04-23', 'planned', v_user_id),
  ('International Hospitality Day', 'To celebrate the industry''s success, promote its importance, and educate on best practices. Sustainability focus. [Internal] [LinkedIn]', 'Internal', '2026-04-24', 'planned', v_user_id),
  ('Stop Food Waste Day', 'Sustainability focus. [Internal]', 'Internal', '2026-04-29', 'planned', v_user_id);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- MAY 2026 — Spring & Mental Health
  -- ═══════════════════════════════════════════════════════════════════════════

  INSERT INTO planning_items (title, description, type_label, target_date, status, created_by) VALUES
  ('National Walking Month', 'All month. Encourage staff to walk to work. [Post] [Campaign]', 'Campaign', '2026-05-01', 'planned', v_user_id),
  ('Early May Bank Holiday', 'Bank Holiday.', 'Occasion', '2026-05-04', 'planned', v_user_id),
  ('VE Day Anniversary', NULL, 'Occasion', '2026-05-08', 'planned', v_user_id),
  ('Mental Health Awareness Week', '11th-17th May. [Internal] [LinkedIn]', 'Internal', '2026-05-11', 'planned', v_user_id),
  ('Learning at Work Week', '18th-24th May. [Internal] [LinkedIn]', 'Internal', '2026-05-18', 'planned', v_user_id),
  ('World Cocktail Day', '[Upselling] [Campaign]', 'Campaign', '2026-05-13', 'planned', v_user_id),
  ('World Whisky Day', '[Upselling] [Campaign]', 'Campaign', '2026-05-16', 'planned', v_user_id),
  ('National Pizza Party Day', '3rd Friday of May. Promote pizza feasts. [Post]', 'Post', '2026-05-15', 'planned', v_user_id),
  ('Spring Bank Holiday', 'Bank Holiday.', 'Occasion', '2026-05-25', 'planned', v_user_id),
  ('National Vegetarian Week', '18th-24th May. [Upselling]', 'Upselling', '2026-05-18', 'planned', v_user_id),
  ('International Tea Day', '[Upselling] [Post]', 'Post', '2026-05-21', 'planned', v_user_id),
  ('National Wine Day', '[Upselling] [Post]', 'Post', '2026-05-25', 'planned', v_user_id),
  ('FA Cup Final', NULL, 'Occasion', '2026-05-16', 'planned', v_user_id),
  ('UEFA Champions League Semi-Finals', NULL, 'Occasion', '2026-04-28', 'planned', v_user_id);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- JUNE 2026 — Summer Socials & Sport
  -- ═══════════════════════════════════════════════════════════════════════════

  INSERT INTO planning_items (title, description, type_label, target_date, status, created_by) VALUES
  ('Volunteers'' Week', 'Staff community engagement. 1st-7th June.', 'Occasion', '2026-06-01', 'planned', v_user_id),
  ('World Cider Day', '[Upselling] [Post]', 'Post', '2026-06-03', 'planned', v_user_id),
  ('National Sausage Roll Day', '[Post]', 'Post', '2026-06-05', 'planned', v_user_id),
  ('National Fish & Chip Day', '[Post]', 'Post', '2026-06-05', 'planned', v_user_id),
  ('World Food Safety Day', 'Training focus. [Internal]', 'Internal', '2026-06-07', 'planned', v_user_id),
  ('World Gin Day', '[Upselling] [Post]', 'Post', '2026-06-13', 'planned', v_user_id),
  ('Beer Day Britain', '15th June (Monday). [Upselling] [Campaign]', 'Campaign', '2026-06-15', 'planned', v_user_id),
  ('Father''s Day', NULL, 'Occasion', '2026-06-21', 'planned', v_user_id),
  ('Take Your Dog to Work Day', 'Friday after Father''s Day.', 'Occasion', '2026-06-26', 'planned', v_user_id),
  ('National Martini Day', '[Upselling] [Campaign]', 'Campaign', '2026-06-19', 'planned', v_user_id),
  ('World Wellbeing Week', '24th-30th June.', 'Occasion', '2026-06-24', 'planned', v_user_id),
  ('National Cream Tea Day', '[Post]', 'Post', '2026-06-26', 'planned', v_user_id),
  ('Wimbledon Tennis Championships begin', NULL, 'Occasion', '2026-06-29', 'planned', v_user_id),
  ('US Open Golf', '18th-21st June. Shinnecock Hills.', 'Occasion', '2026-06-18', 'planned', v_user_id);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- JULY 2026 — Summer Treats
  -- ═══════════════════════════════════════════════════════════════════════════

  INSERT INTO planning_items (title, description, type_label, target_date, status, created_by) VALUES
  ('Ice Cream Month', 'All month. [Post]', 'Post', '2026-07-01', 'planned', v_user_id),
  ('National Cherry Day', '[Post]', 'Post', '2026-07-16', 'planned', v_user_id),
  ('National Daiquiri Day', '[LinkedIn]', 'LinkedIn Post', '2026-07-19', 'planned', v_user_id),
  ('International Safe Places to Work Day', 'Wellbeing focus. [Internal]', 'Internal', '2026-07-24', 'planned', v_user_id),
  ('International Day of Friendship', NULL, 'Occasion', '2026-07-30', 'planned', v_user_id),
  ('Wimbledon Finals', 'Ladies'' Final: Sat 11th; Gentlemen''s Final: Sun 12th.', 'Occasion', '2026-07-11', 'planned', v_user_id),
  ('FIFA World Cup 2026', 'Jun 11 - Jul 19. USA/Mexico/Canada.', 'Occasion', '2026-07-01', 'planned', v_user_id);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- AUGUST 2026 — Leisure & Bank Holidays
  -- ═══════════════════════════════════════════════════════════════════════════

  INSERT INTO planning_items (title, description, type_label, target_date, status, created_by) VALUES
  ('International Beer Day', '7th Aug 2026. [Post]', 'Post', '2026-08-07', 'planned', v_user_id),
  ('Afternoon Tea Week', '10th-16th Aug. [Campaign]', 'Campaign', '2026-08-10', 'planned', v_user_id),
  ('National Prosecco Day', '[Post]', 'Post', '2026-08-13', 'planned', v_user_id),
  ('National Rum Day', '[Campaign]', 'Campaign', '2026-08-16', 'planned', v_user_id),
  ('National Dog Day', 'Could also be LinkedIn? [Campaign]', 'Campaign', '2026-08-26', 'planned', v_user_id),
  ('National Burger Day', '[Post]', 'Post', '2026-08-27', 'planned', v_user_id),
  ('Summer Bank Holiday', 'Bank Holiday.', 'Occasion', '2026-08-31', 'planned', v_user_id);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- SEPTEMBER 2026 — Sustainability & Comfort Food
  -- ═══════════════════════════════════════════════════════════════════════════

  INSERT INTO planning_items (title, description, type_label, target_date, status, created_by) VALUES
  ('Zero Waste Week (UK)', '7th-11th Sep. [Internal] [LinkedIn]', 'Internal', '2026-09-07', 'planned', v_user_id),
  ('Eat an Extra Dessert Day', '[Campaign]', 'Campaign', '2026-09-04', 'planned', v_user_id),
  ('Chef Appreciation Week', '7th-13th Sep. [Internal] [LinkedIn]', 'Internal', '2026-09-07', 'planned', v_user_id),
  ('International Chocolate Day', '[Post]', 'Post', '2026-09-13', 'planned', v_user_id),
  ('Negroni Week', '21st-27th Sep. [Campaign] [Upselling]', 'Campaign', '2026-09-21', 'planned', v_user_id),
  ('National Inclusion Day', '[Internal] [LinkedIn]', 'Internal', '2026-09-14', 'planned', v_user_id),
  ('Cask Ale Week', 'w/c 17th Sep (provisional). [Campaign] [Upselling]', 'Campaign', '2026-09-17', 'planned', v_user_id),
  ('National Hospitality Day UK', '[Internal] [LinkedIn]', 'Internal', '2026-09-18', 'planned', v_user_id),
  ('International Week of Happiness at Work', '21st-25th Sep. [Internal] [LinkedIn]', 'Internal', '2026-09-21', 'planned', v_user_id),
  ('National Bacon Butty Day', '[Campaign]', 'Campaign', '2026-09-23', 'planned', v_user_id),
  ('World''s Biggest Coffee Morning (Macmillan)', '[Campaign]', 'Campaign', '2026-09-25', 'planned', v_user_id);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- OCTOBER 2026 — Autumn Traditions
  -- ═══════════════════════════════════════════════════════════════════════════

  INSERT INTO planning_items (title, description, type_label, target_date, status, created_by) VALUES
  ('British Food Fortnight', 'Sep 26 - Oct 12. Set menu with Sausage & Mash, Fish & Chips, Pies + Full English & roasts. [Campaign]', 'Campaign', '2026-09-26', 'planned', v_user_id),
  ('Oktoberfest', 'All month. [Campaign]', 'Campaign', '2026-10-01', 'planned', v_user_id),
  ('International Coffee Day', '[Post]', 'Post', '2026-10-01', 'planned', v_user_id),
  ('World Vegetarian Day', '[Post] [Campaign]', 'Campaign', '2026-10-01', 'planned', v_user_id),
  ('World Smile Day', '[Internal]', 'Internal', '2026-10-02', 'planned', v_user_id),
  ('International Beer & Pizza Day', 'Promote Pizza Shacks (2 Pizzas, 2 Beers £30, 5-9pm?). [Post]', 'Post', '2026-10-09', 'planned', v_user_id),
  ('World Mental Health Day', '[Internal] [LinkedIn]', 'Internal', '2026-10-10', 'planned', v_user_id),
  ('National Baking Week (HFC)', '14th-20th Oct. [Post]', 'Post', '2026-10-14', 'planned', v_user_id),
  ('Halloween', 'Dining in the dark at R&C, BA, Star, Cricketers. [Campaign]', 'Campaign', '2026-10-31', 'planned', v_user_id);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- NOVEMBER 2026 — Preparation & Reflection
  -- ═══════════════════════════════════════════════════════════════════════════

  INSERT INTO planning_items (title, description, type_label, target_date, status, created_by) VALUES
  ('Movember', 'All month. Men''s health awareness. [Internal]', 'Internal', '2026-11-01', 'planned', v_user_id),
  ('World Vegan Day', '[Post] [Campaign]', 'Campaign', '2026-11-01', 'planned', v_user_id),
  ('National Stress Awareness Day', 'Wellbeing focus. [Internal] [LinkedIn]', 'Internal', '2026-11-04', 'planned', v_user_id),
  ('National Roast Dinner Day', 'Weds 4th Nov 2026. [Campaign]', 'Campaign', '2026-11-04', 'planned', v_user_id),
  ('Guy Fawkes Night (Bonfire Night)', NULL, 'Occasion', '2026-11-05', 'planned', v_user_id),
  ('International Stout Day', NULL, 'Occasion', '2026-11-05', 'planned', v_user_id),
  ('Remembrance Day', '[Post]', 'Post', '2026-11-11', 'planned', v_user_id),
  ('Beaujolais Nouveau Day', 'French-inspired pairing menu: French Onion Soup, Pate, Camembert, Mushroom Risotto(?), Confit Duck. [Post] [Campaign]', 'Campaign', '2026-11-19', 'planned', v_user_id),
  ('National Cake Day (HFC)', '[Post]', 'Post', '2026-11-26', 'planned', v_user_id),
  ('Black Friday', '2026. [Campaign]', 'Campaign', '2026-11-27', 'planned', v_user_id),
  ('Cyber Monday', '[Campaign]', 'Campaign', '2026-11-30', 'planned', v_user_id),
  ('St Andrew''s Day (Scotland Bank Holiday)', '[Campaign]', 'Campaign', '2026-11-30', 'planned', v_user_id);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- DECEMBER 2026 — Festive Season
  -- ═══════════════════════════════════════════════════════════════════════════

  INSERT INTO planning_items (title, description, type_label, target_date, status, created_by) VALUES
  ('English Breakfast Day', '[Post]', 'Post', '2026-12-02', 'planned', v_user_id),
  ('Cookie Day', NULL, 'Occasion', '2026-12-04', 'planned', v_user_id),
  ('Winter Solstice', NULL, 'Occasion', '2026-12-21', 'planned', v_user_id),
  ('Christmas Day', 'Bank Holiday.', 'Occasion', '2026-12-25', 'planned', v_user_id),
  ('Boxing Day', NULL, 'Occasion', '2026-12-26', 'planned', v_user_id),
  ('Boxing Day (Bank Holiday substitute)', 'Substitute bank holiday (Boxing Day falls on Saturday).', 'Occasion', '2026-12-28', 'planned', v_user_id),
  ('New Year''s Eve', NULL, 'Occasion', '2026-12-31', 'planned', v_user_id);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- JANUARY 2027 — Focus on Moderation & New Beginnings
  -- ═══════════════════════════════════════════════════════════════════════════

  INSERT INTO planning_items (title, description, type_label, target_date, status, created_by) VALUES
  ('Dry January', 'All month. [Campaign]', 'Campaign', '2027-01-01', 'planned', v_user_id),
  ('Veganuary', 'All month. [Campaign]', 'Campaign', '2027-01-01', 'planned', v_user_id),
  ('Ginuary', 'All month. [Campaign]', 'Campaign', '2027-01-01', 'planned', v_user_id),
  ('New Year''s Day (Bank Holiday)', 'Friday 1st January 2027.', 'Occasion', '2027-01-01', 'planned', v_user_id),
  ('International Thank You Day', '[Internal] [LinkedIn]', 'Internal', '2027-01-11', 'planned', v_user_id),
  ('Blue Monday', 'Focus on staff mental health/wellbeing. 3rd Monday of January. [Internal]', 'Internal', '2027-01-18', 'planned', v_user_id),
  ('International Sticky Toffee Pudding Day', '[Post] [Upselling]', 'Post', '2027-01-23', 'planned', v_user_id),
  ('Burns Night', 'Sunday 25th January 2027. [LinkedIn]', 'LinkedIn Post', '2027-01-25', 'planned', v_user_id),
  ('National Hot Chocolate Day', '[Post]', 'Post', '2027-01-31', 'planned', v_user_id);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- FEBRUARY 2027 — Romance & Skill Development
  -- ═══════════════════════════════════════════════════════════════════════════

  INSERT INTO planning_items (title, description, type_label, target_date, status, created_by) VALUES
  ('Chinese New Year 2027', '6th-20th Feb. Year of the Horse. Set menus/events? [Campaign]', 'Campaign', '2027-02-06', 'planned', v_user_id),
  ('Ramadan 2027', '7th Feb - 8th March 2027 (approx). [Internal]', 'Internal', '2027-02-07', 'planned', v_user_id),
  ('National Pizza Day', 'Promo Pizza Feasts. [Post] [Campaign]', 'Campaign', '2027-02-09', 'planned', v_user_id),
  ('Shrove Tuesday (Pancake Day)', 'Tuesday 9th Feb 2027. [Campaign]', 'Campaign', '2027-02-09', 'planned', v_user_id),
  ('National Apprenticeship Week', '8th-14th Feb. Great for highlighting staff training/growth. [Internal] [LinkedIn]', 'Internal', '2027-02-08', 'planned', v_user_id),
  ('Galentine''s Day', '[Campaign]', 'Campaign', '2027-02-13', 'planned', v_user_id),
  ('Valentine''s Day', 'Sunday 14th Feb 2027. [Campaign]', 'Campaign', '2027-02-14', 'planned', v_user_id),
  ('Random Acts of Kindness Day', '[Internal] [LinkedIn]', 'Internal', '2027-02-17', 'planned', v_user_id),
  ('Drink Wine Day', '[Post] [Upselling]', 'Post', '2027-02-18', 'planned', v_user_id),
  ('National Margarita Day', '[Post] [Upselling]', 'Post', '2027-02-22', 'planned', v_user_id),
  ('National Hospitality Workers Appreciation Day', '[Internal] [LinkedIn]', 'Internal', '2027-02-23', 'planned', v_user_id),
  ('World Bartender Day', 'Get teams involved with pics? [Internal] [LinkedIn]', 'Internal', '2027-02-24', 'planned', v_user_id);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- MARCH 2027 — Community & Heritage
  -- ═══════════════════════════════════════════════════════════════════════════

  INSERT INTO planning_items (title, description, type_label, target_date, status, created_by) VALUES
  ('British Pie Week', 'Early March (1st-7th). [Campaign]', 'Campaign', '2027-03-01', 'planned', v_user_id),
  ('Six Nations Rugby Matches', 'Feb-Mar 2027.', 'Occasion', '2027-03-01', 'planned', v_user_id),
  ('Employee Appreciation Day', '1st Friday in March. [Internal] [LinkedIn]', 'Internal', '2027-03-05', 'planned', v_user_id),
  ('UEFA Champions League (Round of 16)', NULL, 'Occasion', '2027-03-10', 'planned', v_user_id),
  ('World Compliment Day', 'Staff morale focus. [Internal]', 'Internal', '2027-03-01', 'planned', v_user_id),
  ('St. David''s Day (UK)', NULL, 'Occasion', '2027-03-01', 'planned', v_user_id),
  ('National Butchers Week', '1st-7th March. [Campaign]', 'Campaign', '2027-03-01', 'planned', v_user_id),
  ('Mother''s Day (Mothering Sunday)', '7th March 2027.', 'Occasion', '2027-03-07', 'planned', v_user_id),
  ('International Women''s Day', '[Internal] [LinkedIn]', 'Internal', '2027-03-08', 'planned', v_user_id),
  ('Nutrition and Hydration Week', '15th-21st March. Wellbeing focus. [Internal]', 'Internal', '2027-03-15', 'planned', v_user_id),
  ('St. Patrick''s Day', 'Wednesday 17th March 2027. [Campaign]', 'Campaign', '2027-03-17', 'planned', v_user_id),
  ('International Day of Happiness', '[Internal] [LinkedIn]', 'Internal', '2027-03-20', 'planned', v_user_id),
  ('National Proposal Day (Meade Hall)', '[Post] [Campaign]', 'Campaign', '2027-03-20', 'planned', v_user_id),
  ('National Cocktail Day', '[Post] [Upselling]', 'Post', '2027-03-24', 'planned', v_user_id);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- SPORTING EVENTS (cross-cutting)
  -- ═══════════════════════════════════════════════════════════════════════════

  INSERT INTO planning_items (title, description, type_label, target_date, status, created_by) VALUES
  ('Rugby World Cup (Rugby League)', 'Oct 15 - Nov 15, 2026. Australia & Papua New Guinea. Note: Rugby Union World Cup is 2027.', 'Occasion', '2026-10-15', 'planned', v_user_id),
  ('PGA — The Masters', 'Apr 9-12, 2026. Augusta.', 'Occasion', '2026-04-09', 'planned', v_user_id),
  ('PGA Championship', 'May 14-17, 2026.', 'Occasion', '2026-05-14', 'planned', v_user_id),
  ('The Open Championship', 'Jul 16-19, 2026. Royal Birkdale, England.', 'Occasion', '2026-07-16', 'planned', v_user_id);

  RAISE NOTICE 'Planning calendar seeded successfully for Apr 2026 — Mar 2027.';
END $$;
