-- Fixture for the ADMS simulator (local D1 only).
DELETE FROM adms_lines; DELETE FROM device_commands; DELETE FROM attendance; DELETE FROM bio_templates;
DELETE FROM device_users; DELETE FROM memberships; DELETE FROM members; DELETE FROM devices;

INSERT INTO members (id, essl_id, name, mobile, is_staff, device_state) VALUES
  (9001, '9001', 'Sim Active',  '9000000001', 0, 'active'),
  (9002, '9002', 'Sim Expired', '9000000002', 0, 'active'),
  (9003, 'CGA5', 'Sim Staff',   '9000000003', 1, 'active');

INSERT INTO memberships (member_id, category, duration_label, start_date, end_date, price) VALUES
  (9001, 'Strength', '1 Year',  date('now','-30 day'),  date('now','+300 day'), 9000),
  (9002, 'Strength', '1 Month', date('now','-60 day'),  date('now','-30 day'),  1500),
  (9003, 'Strength', '1 Month', date('now','-90 day'),  date('now','-60 day'),  0);

UPDATE settings SET value = json_set(value, '$.auto_enforce', json('true'), '$.block_method', 'remove') WHERE key = 'access';
