/**
 * Universal Complaint System theme: plain ink on paper, one signal color
 * (a clear blue for actions), and status colors that mean the same thing
 * everywhere. Dark is the default (src/lib/appearance.ts); every color used
 * anywhere in the app comes from here, so this file is the whole look.
 */
export const Colors = {
  light: {
    text: '#14171F',
    textSecondary: '#5D6472',
    background: '#FFFFFF',
    backgroundElement: '#F3F4F7',
    backgroundSelected: '#E3E8FA',
    border: '#E2E5EB',
    primary: '#2346D8',
    primaryFill: '#2346D8',
    primarySoft: '#DDE4FB',
    onPrimary: '#FFFFFF',
    new: '#7A3FD1',
    newSoft: '#EFE6FB',
    rant: '#C2410C',
    rantSoft: '#FDEBDD',
    good: '#15803D',
    goodSoft: '#DCF3E3',
    warning: '#A15C00',
    warningSoft: '#FCEFD8',
    danger: '#C81E3A',
    dangerSoft: '#FBE2E6',
  },
  dark: {
    text: '#F1F3F7',
    textSecondary: '#9AA2B1',
    background: '#0E1117',
    backgroundElement: '#181C25',
    backgroundSelected: '#222B45',
    border: '#262B36',
    // Text, icons and outlines: bright enough to read on the dark background.
    primary: '#7D97FF',
    // Solid buttons: the brand blue, lifted, with white text (5.2:1).
    primaryFill: '#3D5CF5',
    primarySoft: '#1E2A55',
    onPrimary: '#FFFFFF',
    new: '#B795F2',
    newSoft: '#2D2145',
    rant: '#FB8F52',
    rantSoft: '#3B2214',
    good: '#4ADE80',
    goodSoft: '#12301E',
    warning: '#F2B04F',
    warningSoft: '#2B2213',
    danger: '#FF6B81',
    dangerSoft: '#3D1620',
  },
} as const;

export type Palette = Record<keyof (typeof Colors)["light"], string>;
