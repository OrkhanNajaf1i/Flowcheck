-- Revisions are immutable: a saved test change always creates a new revision.
CREATE TRIGGER test_revisions_no_update
BEFORE UPDATE ON test_revisions
BEGIN
  SELECT RAISE(ABORT, 'test_revisions are immutable');
END;
--> statement-breakpoint
-- A run's revision, environment snapshot and inputs snapshot never change after creation.
CREATE TRIGGER test_runs_snapshot_immutable
BEFORE UPDATE OF revision_id, environment_id, environment_snapshot, inputs_snapshot, test_case_id, created_at ON test_runs
BEGIN
  SELECT RAISE(ABORT, 'run snapshots are immutable');
END;
