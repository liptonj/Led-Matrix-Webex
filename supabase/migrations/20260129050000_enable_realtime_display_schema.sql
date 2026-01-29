-- Enable realtime for all tables in display schema
-- Safe to run multiple times; Postgres ignores duplicates in publication.
alter publication supabase_realtime add tables in schema display;
