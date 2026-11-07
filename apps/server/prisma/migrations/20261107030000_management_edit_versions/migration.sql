-- Existing rows start at revision 1; every row edit and grant association change advances it.
ALTER TABLE users ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE roles ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE menus ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

CREATE FUNCTION advance_management_edit_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_edit_version BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION advance_management_edit_version();
CREATE TRIGGER roles_edit_version BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION advance_management_edit_version();
CREATE TRIGGER menus_edit_version BEFORE UPDATE ON menus
  FOR EACH ROW EXECUTE FUNCTION advance_management_edit_version();

-- FK cascades and direct relation writes also invalidate old aggregate snapshots.
CREATE FUNCTION advance_role_grant_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    UPDATE roles SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.role_id;
  END IF;
  IF TG_OP = 'INSERT' THEN
    UPDATE roles SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.role_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.role_id IS DISTINCT FROM OLD.role_id THEN
    UPDATE roles SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.role_id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER role_menus_edit_version AFTER INSERT OR UPDATE OR DELETE ON role_menus
  FOR EACH ROW EXECUTE FUNCTION advance_role_grant_version();

CREATE FUNCTION advance_user_role_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.user_id;
  END IF;
  IF TG_OP = 'INSERT' THEN
    UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.user_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.user_id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER user_roles_edit_version AFTER INSERT OR UPDATE OR DELETE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION advance_user_role_version();
