import { supabase } from "../lib/supabase";

const urlCache = new Map(); // path → { url, expiresAt }

export function invalidateImageUrl(path) {
  if (path) urlCache.delete(path);
}

export async function loadWardrobe() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("wardrobe_items")
    .select("*")
    .eq("user_id", user.id)
    .order("date_added", { ascending: false });

  if (error) {
    console.error("Failed to load wardrobe:", error);
    return [];
  }

  return data.map(row => ({
    id: row.id,
    name: row.name,
    type: row.type,
    category: row.category,
    color: row.color,
    colorDescription: row.color_description,
    pattern: row.pattern,
    gender: row.gender,
    description: row.description,
    imageUrl: row.image_url,
    dateAdded: row.date_added,
  }));
}

export async function addWardrobeItem(item) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("wardrobe_items")
    .insert({
      user_id: user.id,
      name: item.name,
      type: item.type,
      category: item.category,
      color: item.color,
      color_description: item.colorDescription,
      pattern: item.pattern,
      gender: item.gender,
      description: item.description,
      image_url: item.imageUrl || null,
    })
    .select()
    .single();

  if (error) throw error;

  return {
    id: data.id,
    name: data.name,
    type: data.type,
    category: data.category,
    color: data.color,
    colorDescription: data.color_description,
    pattern: data.pattern,
    gender: data.gender,
    description: data.description,
    imageUrl: data.image_url,
    dateAdded: data.date_added,
  };
}

export async function removeWardrobeItem(id) {
  const { error } = await supabase
    .from("wardrobe_items")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

export async function uploadClothingImage(base64Data) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const byteString = atob(base64Data);
  const uint8Array = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    uint8Array[i] = byteString.charCodeAt(i);
  }
  const blob = new Blob([uint8Array], { type: "image/jpeg" });

  const fileName = `${user.id}/${crypto.randomUUID()}.jpg`;

  const { error } = await supabase.storage
    .from("wardrobe-images")
    .upload(fileName, blob, { contentType: "image/jpeg" });

  if (error) throw error;

  return fileName;
}

export async function updateWardrobeItem(id, updates) {
  const dbUpdates = {};
  if (updates.name !== undefined)        dbUpdates.name = updates.name;
  if (updates.category !== undefined)    dbUpdates.category = updates.category;
  if (updates.color !== undefined)       dbUpdates.color = updates.color;
  if (updates.pattern !== undefined)     dbUpdates.pattern = updates.pattern;
  if (updates.description !== undefined) dbUpdates.description = updates.description;

  const { data, error } = await supabase
    .from("wardrobe_items")
    .update(dbUpdates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  return {
    id: data.id,
    name: data.name,
    type: data.type,
    category: data.category,
    color: data.color,
    colorDescription: data.color_description,
    pattern: data.pattern,
    gender: data.gender,
    description: data.description,
    imageUrl: data.image_url,
    dateAdded: data.date_added,
  };
}

export async function deleteClothingImage(path) {
  if (!path) return;
  const { error } = await supabase.storage.from("wardrobe-images").remove([path]);
  if (error) console.warn("Failed to delete image from storage:", error);
  invalidateImageUrl(path);
}

export async function getImageUrl(path) {
  if (!path) return null;
  const cached = urlCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const { data } = await supabase.storage
    .from("wardrobe-images")
    .createSignedUrl(path, 3600);
  const url = data?.signedUrl ?? null;
  if (url) urlCache.set(path, { url, expiresAt: Date.now() + 55 * 60 * 1000 });
  return url;
}
