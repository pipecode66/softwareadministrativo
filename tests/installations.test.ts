import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureInstallationLocation, installationDateTimeInput, installationDurationText, installationScheduleIso, MAX_INSTALLATION_PHOTO_BYTES, prepareInstallationPhoto } from '../src/data/installations';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Programación uniforme en hora de Colombia', () => {
  it('convierte el horario digitado en Bogotá a un instante UTC sin depender de la zona del dispositivo', () => {
    expect(installationScheduleIso('2026-10-28T08:30')).toBe('2026-10-28T13:30:00.000Z');
    expect(installationDateTimeInput('2026-10-28T13:30:00.000Z')).toBe('2026-10-28T08:30');
  });

  it('preserva el día de negocio cuando el instante UTC pertenece al día siguiente', () => {
    expect(installationScheduleIso('2026-10-28T23:45')).toBe('2026-10-29T04:45:00.000Z');
    expect(installationDateTimeInput('2026-10-29T04:45:00Z')).toBe('2026-10-28T23:45');
  });

  it.each(['', '2026-10-28', '2026-02-30T08:00', '2026-10-28T24:00', '2026-10-28T08:61'])('no programa una fecha u hora inexistente: %s', value => {
    expect(() => installationScheduleIso(value)).toThrow(/fecha y hora válidas/);
  });

  it('no muestra una fecha inválida como si hubiera sido guardada', () => {
    expect(installationDateTimeInput('no-es-una-fecha')).toBe('');
  });
});

describe('Duración legible de la jornada', () => {
  it.each([[59.6, '1 h 0 min'], [60, '1 h 0 min'], [119.5, '2 h 0 min'], [119.6, '2 h 0 min'], [61, '1 h 1 min']])('representa %s minutos sin mostrar 60 minutos sueltos', (minutes, expected) => {
    expect(installationDurationText(Number(minutes))).toBe(expected);
  });

  it('no muestra tiempos negativos o ilegibles ante un dato inválido', () => {
    for (const minutes of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(installationDurationText(minutes)).toBe('0 h 0 min');
  });
});

describe('Capturas puntuales de ubicación para Instalaciones', () => {
  it('solicita una posición nueva con permiso del navegador y conserva precisión y fecha de captura', async () => {
    const timestamp = Date.parse('2026-10-26T15:30:00Z');
    const getCurrentPosition = vi.fn((success: PositionCallback, _failure?: PositionErrorCallback, _options?: PositionOptions) => success({
      coords: { latitude: 7.1193, longitude: -73.1227, accuracy: 18 }, timestamp,
    } as GeolocationPosition));
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });

    await expect(captureInstallationLocation()).resolves.toEqual({
      latitude: 7.1193, longitude: -73.1227, accuracy: 18, capturedAt: '2026-10-26T15:30:00.000Z',
    });
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(getCurrentPosition.mock.calls[0]?.[2]).toEqual({ enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 });
  });

  it('no solicita ubicación desde un contexto inseguro', async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('window', { isSecureContext: false });
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    await expect(captureInstallationLocation()).rejects.toThrow(/HTTPS/);
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('informa cuando el dispositivo no tiene acceso a ubicación', async () => {
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', {});
    await expect(captureInstallationLocation()).rejects.toThrow(/solicita una excepción/i);
  });

  it.each([
    [1, /No se autorizó la ubicación/],
    [2, /No fue posible obtener la ubicación/],
    [3, /Se agotó el tiempo/],
  ])('convierte el error GPS %i en una explicación sin informar un guardado inexistente', async (code, message) => {
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', { geolocation: {
      getCurrentPosition: (_success: PositionCallback, failure: PositionErrorCallback) => failure({ code } as GeolocationPositionError),
    } });
    await expect(captureInstallationLocation()).rejects.toThrow(message);
  });

  it('rechaza una respuesta no numérica antes de construir la solicitud', async () => {
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', { geolocation: {
      getCurrentPosition: (success: PositionCallback) => success({
        coords: { latitude: Number.NaN, longitude: -73, accuracy: 10 }, timestamp: Date.now(),
      } as GeolocationPosition),
    } });
    await expect(captureInstallationLocation()).rejects.toThrow(/ubicación válida/);
  });
});

function photoEnvironment(options: { broken?: boolean; emptyDimensions?: boolean; noCanvas?: boolean; encoded?: string } = {}) {
  const createObjectURL = vi.fn(() => 'blob:installation-photo');
  const revokeObjectURL = vi.fn();
  const drawImage = vi.fn();
  const canvas = {
    width: 0, height: 0,
    getContext: vi.fn(() => options.noCanvas ? null : { fillStyle: '', fillRect: vi.fn(), drawImage }),
    toDataURL: vi.fn(() => options.encoded ?? 'data:image/jpeg;base64,/9j/2Q=='),
  };
  class Picture {
    naturalWidth = options.emptyDimensions ? 0 : 2400;
    naturalHeight = options.emptyDimensions ? 0 : 1200;
    onload?: () => void;
    onerror?: () => void;
    set src(_value: string) {
      queueMicrotask(() => options.broken ? this.onerror?.() : this.onload?.());
    }
  }
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  vi.stubGlobal('Image', Picture);
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
  return { createObjectURL, revokeObjectURL, drawImage, canvas };
}

describe('Preparación privada y limitada de evidencia fotográfica', () => {
  it('redibuja y convierte la imagen en JPEG limitado, liberando su URL temporal', async () => {
    const { canvas, drawImage, revokeObjectURL } = photoEnvironment();
    const photo = new File([new Uint8Array([1, 2, 3])], 'fachada.png', { type: 'image/png' });
    await expect(prepareInstallationPhoto(photo)).resolves.toEqual({
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==', filename: 'fachada.jpg', bytes: 4,
    });
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(800);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', .82);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:installation-photo');
  });

  it('rechaza documentos que no sean fotografías y originales vacíos o excesivos', async () => {
    const { createObjectURL } = photoEnvironment();
    await expect(prepareInstallationPhoto(new File(['text'], 'privado.txt', { type: 'text/plain' })))
      .rejects.toThrow(/fotografía válida/);
    await expect(prepareInstallationPhoto(new File([], 'vacia.jpg', { type: 'image/jpeg' })))
      .rejects.toThrow(/20 MB/);
    await expect(prepareInstallationPhoto({ type: 'image/jpeg', size: 20 * 1024 * 1024 + 1 } as File))
      .rejects.toThrow(/20 MB/);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it.each([
    [{ broken: true }, /No pudimos leer/],
    [{ emptyDimensions: true }, /dimensiones válidas/],
    [{ noCanvas: true }, /no permite preparar/],
    [{ encoded: 'data:image/png;base64,AAAA' }, /fotografías JPEG/],
  ])('libera la URL temporal cuando no se puede preparar la imagen: %j', async (options, message) => {
    const { revokeObjectURL } = photoEnvironment(options);
    await expect(prepareInstallationPhoto(new File(['photo'], 'sitio.jpg', { type: 'image/jpeg' })))
      .rejects.toThrow(message);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:installation-photo');
  });

  it('intenta comprimir y reducir dimensiones pero nunca entrega una evidencia que supere el límite', async () => {
    const encoded = 'data:image/jpeg;base64,' + 'A'.repeat(Math.ceil((MAX_INSTALLATION_PHOTO_BYTES + 10) * 4 / 3));
    const { canvas, revokeObjectURL } = photoEnvironment({ encoded });
    await expect(prepareInstallationPhoto(new File(['photo'], 'muy-grande.jpg', { type: 'image/jpeg' })))
      .rejects.toThrow(/reducir la fotografía/);
    expect(canvas.toDataURL.mock.calls.length).toBeGreaterThan(4);
    expect(canvas.width).toBeLessThan(1600);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:installation-photo');
  });
});
