ALTER TABLE profiles ADD COLUMN active_project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
