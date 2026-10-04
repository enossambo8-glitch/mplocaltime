ALTER TABLE stories ADD CONSTRAINT fk_stories_published_by FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE stories ADD CONSTRAINT fk_stories_submitted_by FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE editorial_notes ADD CONSTRAINT fk_editorial_notes_story FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE;
ALTER TABLE editorial_notes ADD CONSTRAINT fk_editorial_notes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE story_corrections ADD CONSTRAINT fk_story_corrections_story FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE;
ALTER TABLE story_corrections ADD CONSTRAINT fk_story_corrections_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE revision_history ADD CONSTRAINT fk_revision_history_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL;
