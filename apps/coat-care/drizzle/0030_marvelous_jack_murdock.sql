ALTER TABLE `timesheet_shifts` ADD `location_id` text REFERENCES locations(id);--> statement-breakpoint
UPDATE `timesheet_shifts`
SET `location_id` = (
  SELECT `locations`.`id`
  FROM `locations`
  WHERE `locations`.`organization_id` = `timesheet_shifts`.`organization_id`
    AND `locations`.`name` = `timesheet_shifts`.`location_name`
  ORDER BY `locations`.`id`
  LIMIT 1
)
WHERE (
  SELECT count(*)
  FROM `locations`
  WHERE `locations`.`organization_id` = `timesheet_shifts`.`organization_id`
    AND `locations`.`name` = `timesheet_shifts`.`location_name`
) = 1;--> statement-breakpoint
CREATE INDEX `timesheet_shift_location_date_idx` ON `timesheet_shifts` (`location_id`,`work_date`);
