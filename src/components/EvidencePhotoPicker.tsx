import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Image as ImageIcon, LoaderCircle, X } from 'lucide-react';
import type { EvidencePickerPhoto } from '../usePersistedEvidence';

type EvidencePhotoPickerProps = {
  photos: EvidencePickerPhoto[];
  onAddFiles: (files: File[]) => void;
  onRemove: (photoId: string) => void;
  emptyLabel?: string;
};

type CameraZoomCapabilities = MediaTrackCapabilities & {
  zoom?: {
    min: number;
    max: number;
  };
};

const setNormalCameraZoom = async (stream: MediaStream) => {
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) return;

  const capabilities = videoTrack.getCapabilities?.() as CameraZoomCapabilities | undefined;
  if (!capabilities?.zoom || capabilities.zoom.min > 1 || capabilities.zoom.max < 1) return;

  try {
    await videoTrack.applyConstraints({
      advanced: [{ zoom: 1 } as unknown as MediaTrackConstraintSet],
    });
  } catch {
    // Alguns navegadores móveis informam o zoom, mas não aceitam alterá-lo via código.
  }
};

export function EvidencePhotoPicker({ photos, onAddFiles, onRemove, emptyLabel = 'Nenhuma foto anexada' }: EvidencePhotoPickerProps) {
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState('');

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  useEffect(() => {
    if (!cameraOpen) {
      stopCamera();
      return undefined;
    }

    let active = true;
    setCameraLoading(true);
    setCameraError('');

    navigator.mediaDevices
      ?.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1600 },
          height: { ideal: 1200 },
        },
        audio: false,
      })
      .then(async (stream) => {
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        await setNormalCameraZoom(stream);
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      })
      .catch(() => {
        if (active) setCameraError('Não foi possível abrir a câmera. Use Galeria ou verifique a permissão do navegador.');
      })
      .finally(() => {
        if (active) setCameraLoading(false);
      });

    return () => {
      active = false;
      stopCamera();
    };
  }, [cameraOpen]);

  useEffect(() => {
    if (!cameraOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [cameraOpen]);

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      setCameraError('A câmera ainda está carregando.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const context = canvas.getContext('2d');
    if (!context) {
      setCameraError('Não foi possível capturar a imagem.');
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraError('Não foi possível gerar a foto.');
          return;
        }

        const file = new File([blob], `foto-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`, { type: 'image/jpeg' });
        onAddFiles([file]);
        setCameraOpen(false);
      },
      'image/jpeg',
      0.88
    );
  };

  return (
    <div className="release-evidence-box">
      <div className="release-evidence-header">
        <strong>{photos.length ? `${photos.length} foto${photos.length > 1 ? 's' : ''} anexada${photos.length > 1 ? 's' : ''}` : emptyLabel}</strong>
        <span>Mínimo obrigatório: 1 foto salva</span>
      </div>

      <div className="pending-photo-list">
        {photos.map((photo, index) => (
          <div className={`pending-photo-thumb state-${photo.state}`} key={photo.id}>
            {photo.previewUrl ? (
              <img src={photo.previewUrl} alt={`Foto anexada ${index + 1}`} />
            ) : (
              <ImageIcon size={24} aria-label={`Foto salva ${index + 1}`} />
            )}
            <span className="photo-state-label">
              {photo.state === 'saved' && (photo.statusLabel || 'Salva')}
              {photo.state === 'pending' && 'Não salva'}
              {photo.state === 'uploading' && 'Enviando'}
              {photo.state === 'error' && 'Erro'}
            </span>
            {photo.removable && (
              <button type="button" onClick={() => onRemove(photo.id)} aria-label="Remover foto">
                <X size={14} />
              </button>
            )}
          </div>
        ))}

        <button className="add-photo-tile" type="button" onClick={() => setCameraOpen(true)}>
          <Camera size={18} />
          <span>Tirar foto</span>
        </button>
        <button className="add-photo-tile" type="button" onClick={() => galleryInputRef.current?.click()}>
          <ImageIcon size={18} />
          <span>Galeria</span>
        </button>
      </div>

      <input
        ref={galleryInputRef}
        className="photo-file-input"
        accept="image/*"
        type="file"
        multiple
        onChange={(event) => {
          onAddFiles(Array.from(event.target.files || []));
          event.target.value = '';
        }}
      />

      {cameraOpen &&
        createPortal(
          <div className="camera-overlay" role="presentation">
            <section className="camera-panel" role="dialog" aria-modal="true" aria-labelledby="camera-title">
              <header className="camera-panel-header">
                <div>
                  <strong id="camera-title">Capturar foto</strong>
                  <span>Enquadre o material antes de fotografar.</span>
                </div>
                <button className="icon-button" type="button" onClick={() => setCameraOpen(false)} aria-label="Fechar câmera">
                  <X size={20} />
                </button>
              </header>

              <div className="camera-stage">
                <div className="camera-preview">
                  {cameraLoading && (
                    <span>
                      <LoaderCircle className="spin" size={22} />
                      Abrindo câmera...
                    </span>
                  )}
                  <video ref={videoRef} playsInline muted autoPlay />
                </div>
                {cameraError && <p className="camera-error">{cameraError}</p>}
              </div>

              <div className="camera-actions">
                <button className="secondary-button" type="button" onClick={() => setCameraOpen(false)}>
                  Cancelar
                </button>
                <button className="card-action-button" type="button" onClick={capturePhoto} disabled={cameraLoading || Boolean(cameraError)}>
                  <Camera size={17} />
                  Capturar foto
                </button>
              </div>
            </section>
          </div>,
          document.body
        )}
    </div>
  );
}
