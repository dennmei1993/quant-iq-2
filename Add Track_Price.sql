-- Migration: add track_price column to assets table
-- Run in Supabase SQL editor

-- 1. Add the column
ALTER TABLE public.assets 
ADD COLUMN IF NOT EXISTS track_price boolean NOT NULL DEFAULT false;

-- 2. Seed: P1 + P2 assets get track_price = true immediately
UPDATE public.assets 
SET track_price = true
WHERE is_active = true
AND bootstrap_priority IN (1, 2);

-- 3. Index for the daily price cron query
CREATE INDEX IF NOT EXISTS idx_assets_track_price 
ON public.assets (asset_type, track_price, is_active)
WHERE track_price = true AND is_active = true;

-- 4. Verify
SELECT 
  asset_type,
  bootstrap_priority,
  COUNT(*) FILTER (WHERE track_price = true)  as track_price_on,
  COUNT(*) FILTER (WHERE track_price = false) as track_price_off,
  COUNT(*) as total
FROM public.assets
WHERE is_active = true
GROUP BY asset_type, bootstrap_priority
ORDER BY asset_type, bootstrap_priority;