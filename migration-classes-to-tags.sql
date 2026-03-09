-- Migration: members.classes / staff.classes from classroom names to calendar_tag
-- Run once only after deploying the new JS code

-- Step 1: Fix duplicate calendar_tags (using UUIDs to avoid encoding issues)
-- kakekojyuku approach
UPDATE classrooms SET calendar_tag = 'kakekojyuku-approach'
  WHERE id = '5e2cd3b7-9daf-43e8-b21b-6a387ab30180';

-- kakekojyuku hop-step-jump
UPDATE classrooms SET calendar_tag = 'kakekojyuku-hsj'
  WHERE id = '4de26c1b-c368-4518-a7d1-4a07f0b360fa';

-- badminton takaodai junior
UPDATE classrooms SET calendar_tag = 'badminton-takaodai-jr'
  WHERE id = '2cf51990-820d-4f1a-9869-1b91205cfe42';

-- badminton takaodai beginner
UPDATE classrooms SET calendar_tag = 'badminton-takaodai-bg'
  WHERE id = '69ea6398-b945-4c58-9da1-4b7d83668a30';

-- Step 2: Fill empty calendar_tag (ice skating)
UPDATE classrooms SET calendar_tag = 'ice-skating'
  WHERE id = '3c341923-be7b-4ef3-bf87-0ef7bc405b3f';

-- Step 3: Fill any remaining empty calendar_tags with a generated value
UPDATE classrooms SET calendar_tag = 'class-' || SUBSTRING(id::text, 1, 8)
  WHERE calendar_tag IS NULL OR calendar_tag = '';

-- Step 4: Add UNIQUE constraint
ALTER TABLE classrooms
  ADD CONSTRAINT classrooms_calendar_tag_unique UNIQUE (calendar_tag);

-- Step 5: Convert members.classes from classroom names to calendar_tags
UPDATE members SET classes = (
  SELECT ARRAY(
    SELECT CASE
      WHEN c.calendar_tag IS NOT NULL AND c.calendar_tag != '' THEN c.calendar_tag
      ELSE elem
    END
    FROM unnest(members.classes) AS elem
    LEFT JOIN classrooms c ON c.name = elem
  )
)
WHERE classes IS NOT NULL AND array_length(classes, 1) > 0;

-- Step 6: Convert staff.classes from classroom names to calendar_tags
UPDATE staff SET classes = (
  SELECT ARRAY(
    SELECT CASE
      WHEN c.calendar_tag IS NOT NULL AND c.calendar_tag != '' THEN c.calendar_tag
      ELSE elem
    END
    FROM unnest(staff.classes) AS elem
    LEFT JOIN classrooms c ON c.name = elem
  )
)
WHERE classes IS NOT NULL AND array_length(classes, 1) > 0;
