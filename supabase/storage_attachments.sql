-- Supabase Storage setup for HaruTodo task attachments
-- Run this once in Supabase Dashboard -> SQL Editor

insert into storage.buckets (id, name, public, file_size_limit)
values ('task-attachments', 'task-attachments', false, 52428800)
on conflict (id) do update
set public = false,
    file_size_limit = 52428800;

drop policy if exists "haru_attachments_select" on storage.objects;
create policy "haru_attachments_select"
on storage.objects for select
to authenticated
using (
  bucket_id = 'task-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "haru_attachments_insert" on storage.objects;
create policy "haru_attachments_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'task-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "haru_attachments_update" on storage.objects;
create policy "haru_attachments_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'task-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "haru_attachments_delete" on storage.objects;
create policy "haru_attachments_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'task-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);
