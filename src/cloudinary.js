// Dish photo upload to Cloudinary ("unsigned" upload: the browser uploads
// directly to the Cloudinary bucket, without going through a server of ours).
// Requires two environment variables, taken from the Cloudinary console:
//   VITE_CLOUDINARY_CLOUD_NAME   → cloud name (top right of the Dashboard)
//   VITE_CLOUDINARY_UPLOAD_PRESET → name of an "Unsigned" upload preset
// See GUIDA.md for the setup steps.

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB, generous margin for phone photos

// Uploads an image file to Cloudinary and returns its public URL (already
// optimized at delivery time via optimizedImageUrl, not at upload time).
export async function uploadMenuImage(file) {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    throw new Error("Upload immagini non configurato (mancano le variabili Cloudinary in .env).");
  }
  if (!file.type || !file.type.startsWith("image/")) {
    throw new Error("Il file scelto non è un'immagine.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Immagine troppo grande (massimo 8 MB).");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", UPLOAD_PRESET);
  formData.append("folder", "menu");

  let res;
  try {
    res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: "POST",
      body: formData,
    });
  } catch {
    throw new Error("Caricamento non riuscito: controlla la connessione e riprova.");
  }

  if (!res.ok) {
    throw new Error("Caricamento non riuscito: riprova tra poco.");
  }

  const data = await res.json();
  return data.secure_url;
}

// Builds an optimized delivery URL (modern format + automatic compression +
// resizing) from a Cloudinary secure_url, inserting the transform
// parameters after "/upload/". If the URL isn't a Cloudinary one (e.g.
// pasted by hand from another site), it is returned unchanged.
export function optimizedImageUrl(url, { width } = {}) {
  if (!url || !url.includes("/upload/")) return url;
  const transforms = ["f_auto", "q_auto"];
  if (width) transforms.push(`w_${width}`, "dpr_auto");
  return url.replace("/upload/", `/upload/${transforms.join(",")}/`);
}
