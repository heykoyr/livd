import type { SeedCountry } from './types';

/**
 * United Arab Emirates. Communities as residents and agents name them.
 * Waterfront communities (the Marina, Reem, Yas) get a tight spread so a
 * sample point stays on land.
 */
export const UNITED_ARAB_EMIRATES: SeedCountry = {
  code: 'AE',
  cities: [
    {
      name: 'Dubai',
      region: 'Dubai',
      tier: 'major',
      properties: 170,
      rentIndex: 1.2,
      spreadMeters: 300,
      neighbourhoods: [
        ['Dubai Marina', 25.080, 55.140, 2, 1.3],
        ['Jumeirah Lake Towers', 25.069, 55.145, 1, 1.1],
        ['Jumeirah Village Circle', 25.060, 55.210, 2, 0.85],
        ['Downtown Dubai', 25.195, 55.275, 1, 1.6],
        ['Business Bay', 25.186, 55.270, 1, 1.25],
        ['Al Barsha', 25.110, 55.200, 1, 0.95],
        ['Deira', 25.270, 55.310, 1, 0.7],
        ['Bur Dubai', 25.255, 55.295, 1, 0.75],
        ['Al Karama', 25.245, 55.305, 1, 0.7],
        ['International City', 25.165, 55.410, 1, 0.5],
        ['Discovery Gardens', 25.040, 55.140, 1, 0.65],
        ['Dubai Silicon Oasis', 25.120, 55.380, 1, 0.75],
        ['Mirdif', 25.220, 55.420, 1, 0.9],
        ['Arabian Ranches', 25.055, 55.270, 1, 1.4],
        ['Al Nahda', 25.290, 55.370, 1, 0.65],
        ['Jumeirah', 25.215, 55.255, 1, 1.4],
        ['Dubai Sports City', 25.040, 55.220, 1, 0.8],
        ['Al Qusais', 25.280, 55.380, 1, 0.65],
      ],
    },
    {
      name: 'Abu Dhabi',
      region: 'Abu Dhabi',
      tier: 'secondary',
      properties: 90,
      rentIndex: 1.1,
      spreadMeters: 300,
      neighbourhoods: [
        ['Al Reem Island', 24.500, 54.405, 2, 1.15],
        ['Khalifa City', 24.420, 54.575, 1, 1.0],
        ['Al Raha Beach', 24.450, 54.605, 1, 1.25],
        ['Mohammed Bin Zayed City', 24.340, 54.540, 1, 0.85],
        ['Al Khalidiyah', 24.470, 54.345, 1, 1.1],
        ['Al Muroor', 24.454, 54.387, 1, 0.9],
        ['Al Mushrif', 24.440, 54.395, 1, 1.0],
        ['Yas Island', 24.490, 54.605, 1, 1.3],
        ['Saadiyat Island', 24.540, 54.435, 1, 1.5],
      ],
    },
    {
      name: 'Sharjah',
      region: 'Sharjah',
      tier: 'secondary',
      properties: 50,
      rentIndex: 0.55,
      spreadMeters: 350,
      neighbourhoods: [
        ['Al Majaz', 25.325, 55.385, 1, 1.1],
        ['Al Nahda', 25.300, 55.375, 1, 1.0],
        ['Al Khan', 25.320, 55.365, 1, 1.0],
        ['Muwaileh', 25.300, 55.450, 1, 0.9],
        ['Al Taawun', 25.310, 55.375, 1, 1.05],
      ],
    },
  ],
};
