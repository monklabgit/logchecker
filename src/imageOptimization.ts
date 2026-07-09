const MAX_EVIDENCE_IMAGE_EDGE = 1800;
const EVIDENCE_IMAGE_QUALITY = 0.82;
const MIN_SIZE_TO_OPTIMIZE = 900 * 1024;

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Arquivo vazio.')));
    reader.onerror = () => reject(new Error('Não foi possível abrir a imagem.'));
    reader.readAsDataURL(file);
  });

const loadImage = (dataUrl: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Não foi possível preparar a imagem.'));
    image.src = dataUrl;
  });

const canvasToBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Não foi possível otimizar a imagem.'))),
      'image/jpeg',
      EVIDENCE_IMAGE_QUALITY
    );
  });

export async function optimizeEvidencePhoto(file: File) {
  if (!file.type.startsWith('image/')) return file;

  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const largestEdge = Math.max(image.width, image.height);
  const shouldResize = largestEdge > MAX_EVIDENCE_IMAGE_EDGE;

  if (!shouldResize && file.size < MIN_SIZE_TO_OPTIMIZE) return file;

  const scale = shouldResize ? MAX_EVIDENCE_IMAGE_EDGE / largestEdge : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const context = canvas.getContext('2d');
  if (!context) return file;

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas);

  if (blob.size >= file.size) return file;

  const filename = file.name.replace(/\.[^.]+$/, '') || 'evidencia';
  return new File([blob], `${filename}.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}
