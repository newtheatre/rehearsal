-- Every EXTERNAL record, including those with a null expiry.
-- Before this column the recalculation skipped by source, unconditionally, so
-- anything narrower would start rewriting rows it has never rewritten.
UPDATE `records` SET `expiry_overridden` = 1 WHERE `source` = 'EXTERNAL';
