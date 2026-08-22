export interface ViewportSize {
  width: number;
  height: number;
}

export interface FittedRect extends ViewportSize {
  left: number;
  top: number;
}

/**
 * Return the smallest usable rectangle reported for the current display.
 *
 * Some Wayland compositors can leave Chromium with a layout viewport from a
 * previous/larger output mode while the kiosk surface is clipped to the
 * current screen. Constraining the app to the smallest browser and screen
 * measurements keeps its coordinate system inside the pixels that are
 * actually visible.
 */
export const smallestViewport = (...sizes: Array<ViewportSize | undefined>): ViewportSize => {
  const valid = sizes.filter(
    (size): size is ViewportSize => Boolean(size && size.width > 0 && size.height > 0),
  );

  if (valid.length === 0) return { width: 0, height: 0 };

  return {
    width: Math.floor(Math.min(...valid.map((size) => size.width))),
    height: Math.floor(Math.min(...valid.map((size) => size.height))),
  };
};

export const COMPACT_MAX_WIDTH = 520;
export const COMPACT_MAX_HEIGHT = 300;

const STANDARD_PROJECTION_SIZES: ViewportSize[] = [
  { width: 800, height: 480 },
  { width: 960, height: 540 },
  { width: 1024, height: 600 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
];

/**
 * The compact shell is intended for the low-resolution RTI replacement
 * displays. Requiring only one dimension to cross the threshold also handles
 * unusually wide panels such as 480x248 without affecting 800x480 and larger
 * installations.
 */
export const isCompactViewport = ({ width, height }: ViewportSize): boolean =>
  width > 0 && height > 0 &&
  (width <= COMPACT_MAX_WIDTH || height <= COMPACT_MAX_HEIGHT);

/** Fit one aspect ratio inside another without cropping or stretching. */
export const fitInside = (
  viewport: ViewportSize,
  content: ViewportSize,
): FittedRect => {
  if (viewport.width <= 0 || viewport.height <= 0 || content.width <= 0 || content.height <= 0) {
    return { width: 0, height: 0, left: 0, top: 0 };
  }

  const scale = Math.min(
    viewport.width / content.width,
    viewport.height / content.height,
  );
  const width = content.width * scale;
  const height = content.height * scale;

  return {
    width,
    height,
    left: Math.max(0, (viewport.width - width) / 2),
    top: Math.max(0, (viewport.height - height) / 2),
  };
};

/**
 * Low-resolution dongle requests are not handled consistently by Android Auto.
 * Compact screens therefore render a standard 800x480 stream and downscale it
 * locally. Other displays retain the existing opt-in snapping behaviour.
 */
export const projectionRequestSize = (
  viewport: ViewportSize,
  useStandardizedResolution: boolean,
): ViewportSize => {
  const shouldStandardize = isCompactViewport(viewport) || useStandardizedResolution;
  if (!shouldStandardize) return viewport;

  return STANDARD_PROJECTION_SIZES.find(
    (size) => size.width >= viewport.width && size.height >= viewport.height,
  ) ?? viewport;
};
