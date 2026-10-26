// Photo check's words (its src/copy.ts), test-only, for photo-summary.ts;
// replaced by src/words in Task 7.
// Every word the page says, in one place.

// From Photo check's shared/copy.ts:
/** Puts values into a sentence: fill("{n} photos", { n: 3 }). A name
 * with no value is left as it is, so a missing one shows. */
const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (all, key: string) =>
    key in values ? String(values[key]) : all,
  );

export const copy = {
  title: "Photo check",
  intro:
    "Drop in a photo to see what it gives away, and get a clean copy without it.",
  example: "Example photo",
  // Over the drop zone; the answer's label is the photo's name, or this
  // for several.
  fileLabel: "Your photos",
  photos: { one: "{n} photo", other: "{n} photos" },
  drop: "Drop photos here, or choose them",
  gps: "This photo carries the exact place it was taken ({lat}, {lon}). Anyone you send it to can see it.",
  place: "It names a place: {place}.",
  device: "It names the camera that took it: {camera}.",
  lens: " The lens: {lens}.",
  serial:
    "It records serial numbers that can identify the camera or lens: {serial}.",
  date: "It records when it was taken: {date}.",
  software: "It names the software that last saved it: {software}.",
  names: "It names a person: {name}.",
  contact: "It holds contact details: {contact}.",
  caption: "It carries a caption: {caption}.",
  comment: "It carries a comment: {comment}.",
  nothing:
    "Nothing personal found. This photo carries no location, device or name.",
  showAll: "Show everything",
  hide: "Hide",
  cleanOne: "Download a clean copy",
  cleanMany: "Download {n} clean copies as one .zip",
  heic: "This browser can’t show this HEIC photo, so there’s no preview here.",
  unknownType:
    "This isn’t a photo this page can read. It reads JPEG, PNG, WebP and HEIC.",
  // A file over the size cap (answer.ts, MAX_MB): never read.
  tooBig:
    "This file is too big for this page to read. It reads photos up to {n} MB.",
  // The page's reader didn't load (the network, or a newer version of the
  // page since this one opened). Also in index.html, so the page can say it
  // without loading this file.
  wrong: "Something went wrong while reading. Try again.",
  unreadable: "This page couldn’t read this photo’s details.",
  cantClean: "This photo stores its details in a way this page can’t clean.",
  damaged: "No clean copy: this file is damaged.",
  noCleanCopy:
    "No clean copy: this photo stores its details in a way this page can’t clean.",
  kept: "The picture itself isn’t re-saved, so it keeps its full quality.",
  keptMany:
    "The pictures themselves aren’t re-saved, so they keep their full quality.",

  // Several photos at once: what they give away, together, first.
  reading: { one: "Reading {n} photo…", other: "Reading {n} photos…" },
  batchPlace: {
    one: "{n} of {total} photos carries the exact place it was taken.",
    other: "{n} of {total} photos carry the exact place they were taken.",
  },
  batchPlaceAll: "All {total} photos carry the exact place they were taken.",
  batchPlaceBoth: "Both photos carry the exact place they were taken.",
  batchNoPlace: "None of these {total} photos carries the place it was taken.",
  batchNoPlaceNeither: "Neither photo carries the place it was taken.",
  batchOther: {
    one: "{n} of them gives away other details, listed below.",
    other: "{n} of them give away other details, listed below.",
  },
  batchOtherBoth: "Both of them give away other details, listed below.",
  batchNothing: "Nothing personal found in these {total} photos.",
  batchNoPhotos: "None of these files is a photo this page can read.",
  batchNoCopy: {
    one: "{n} file has no clean copy; its row says why.",
    other: "{n} files have no clean copy; their rows say why.",
  },

  // A file's size.
  bytes: { one: "{n} byte", other: "{n} bytes" },
  kb: "{n} KB",
  mb: "{n} MB",

  // "Show everything": where each value came from, and what the common
  // codes mean.
  blocks: {
    exif: "Exif",
    gps: "GPS",
    xmp: "XMP",
    iptc: "IPTC",
    text: "Text",
  },
  values: {
    Orientation: {
      1: "upright",
      2: "mirrored",
      3: "turned 180°",
      4: "turned 180°, mirrored",
      5: "turned 90° left, mirrored",
      6: "turned 90° right",
      7: "turned 90° right, mirrored",
      8: "turned 90° left",
    },
    ResolutionUnit: { 1: "none", 2: "inches", 3: "centimeters" },
    FocalPlaneResolutionUnit: { 1: "none", 2: "inches", 3: "centimeters" },
    ColorSpace: { 1: "sRGB", 65535: "uncalibrated" },
    YCbCrPositioning: { 1: "centered", 2: "co-sited" },
    ExposureProgram: {
      0: "not set",
      1: "manual",
      2: "automatic",
      3: "aperture priority",
      4: "shutter priority",
      5: "creative",
      6: "action",
      7: "portrait",
      8: "landscape",
    },
    MeteringMode: {
      0: "unknown",
      1: "average",
      2: "center-weighted",
      3: "spot",
      4: "multi-spot",
      5: "pattern",
      6: "partial",
      255: "other",
    },
    WhiteBalance: { 0: "automatic", 1: "manual" },
    ExposureMode: { 0: "automatic", 1: "manual", 2: "bracketed" },
    SceneCaptureType: {
      0: "standard",
      1: "landscape",
      2: "portrait",
      3: "night",
    },
    GPSAltitudeRef: { 0: "above sea level", 1: "below sea level" },
  } as Record<string, Record<number, string>>,
  flash: { fired: "fired", not: "didn’t fire" },
  // ComponentsConfiguration: the order the colour channels are stored in.
  channels: { 1: "Y", 2: "Cb", 3: "Cr", 4: "R", 5: "G", 6: "B" } as Record<
    number,
    string
  >,
} as const;

export { fill };

/** The one or the other form, by count, filled in. */
export const plural = (
  forms: { one: string; other: string },
  values: Record<string, string | number> & { n: number },
) => fill(values.n === 1 ? forms.one : forms.other, values);

/** What several photos give away together: how many carry the place,
 * and how many other details. Two are "both" or "neither", never "all 2". */
export function together(counts: {
  total: number;
  place: number;
  other: number;
}): string[] {
  const { total, place, other } = counts;
  const two = total === 2;
  const lines = [
    place === total
      ? two
        ? copy.batchPlaceBoth
        : fill(copy.batchPlaceAll, { total })
      : place
        ? plural(copy.batchPlace, { n: place, total })
        : other
          ? two
            ? copy.batchNoPlaceNeither
            : fill(copy.batchNoPlace, { total })
          : fill(copy.batchNothing, { total }),
  ];
  if (other) {
    lines.push(
      two && other === total
        ? copy.batchOtherBoth
        : plural(copy.batchOther, { n: other }),
    );
  }
  return lines;
}
