-- ============================================================
-- Run this in the Supabase SQL Editor AFTER running prisma migrate
-- ============================================================

-- 1. Foreign key to auth.users (Prisma can't generate this)
ALTER TABLE wardrobe_items
  ADD CONSTRAINT wardrobe_items_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Enable Row Level Security
ALTER TABLE wardrobe_items ENABLE ROW LEVEL SECURITY;

-- 3. RLS policies — each user can only access their own items
CREATE POLICY "Users can view own items"
  ON wardrobe_items FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own items"
  ON wardrobe_items FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own items"
  ON wardrobe_items FOR DELETE
  USING (auth.uid() = user_id);

-- 4. Enable REPLICA IDENTITY FULL so realtime DELETE events include all columns (e.g. image_url)
ALTER TABLE wardrobe_items REPLICA IDENTITY FULL;

-- 5. RLS policy — users can update their own items
CREATE POLICY "Users can update own items"
  ON wardrobe_items FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 6. Storage bucket for clothing images (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('wardrobe-images', 'wardrobe-images', false);

-- 7. Storage RLS — users upload/view/delete only in their own folder
CREATE POLICY "Users can upload own images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'wardrobe-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can view own images"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'wardrobe-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can delete own images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'wardrobe-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
