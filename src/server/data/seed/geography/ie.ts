import type { SeedCountry } from './types';

/** Ireland. Counties as the original sample writes County Dublin. */
export const IRELAND: SeedCountry = {
  code: 'IE',
  cities: [
    {
      name: 'Dublin',
      region: 'County Dublin',
      tier: 'major',
      properties: 150,
      rentIndex: 1.3,
      neighbourhoods: [
        ['Portobello', 53.331, -6.266, 1, 1.1],
        ['Rathmines', 53.322, -6.265, 2, 1.05],
        ['Ranelagh', 53.325, -6.255, 1, 1.15],
        ['Phibsborough', 53.360, -6.273, 1, 0.95],
        ['Drumcondra', 53.370, -6.255, 1, 0.95],
        ['Stoneybatter', 53.353, -6.284, 1, 1.0],
        ['Smithfield', 53.349, -6.279, 1, 1.0],
        ['Ringsend', 53.340, -6.225, 1, 1.1],
        ['Clontarf', 53.365, -6.210, 1, 1.05],
        ['Glasnevin', 53.375, -6.270, 1, 0.95],
        ['Ballsbridge', 53.330, -6.230, 1, 1.25],
        ["Harold's Cross", 53.325, -6.280, 1, 1.0],
        ['Rathfarnham', 53.300, -6.285, 1, 1.0],
        ['Inchicore', 53.338, -6.320, 1, 0.85],
        ['Sandyford', 53.275, -6.220, 1, 1.05],
        ['Dún Laoghaire', 53.294, -6.135, 1, 1.05],
      ],
    },
    {
      name: 'Cork',
      region: 'County Cork',
      tier: 'secondary',
      properties: 50,
      rentIndex: 1.0,
      neighbourhoods: [
        ['Douglas', 51.875, -8.435, 1, 1.05],
        ['Ballintemple', 51.893, -8.440, 1, 1.1],
        ["Sunday's Well", 51.901, -8.490, 1, 0.95],
        ['Wilton', 51.880, -8.505, 1, 0.95],
        ['Blackrock', 51.895, -8.410, 1, 1.05],
        ['Shandon', 51.903, -8.477, 1, 0.95],
      ],
    },
    {
      name: 'Galway',
      region: 'County Galway',
      tier: 'smaller',
      properties: 30,
      rentIndex: 1.0,
      neighbourhoods: [
        ['Salthill', 53.261, -9.075, 1, 1.1],
        ['Newcastle', 53.280, -9.070, 1, 0.95],
        ['Knocknacarra', 53.260, -9.110, 1, 1.0],
        ['Renmore', 53.275, -9.020, 1, 0.95],
      ],
    },
    {
      name: 'Limerick',
      region: 'County Limerick',
      tier: 'smaller',
      properties: 25,
      rentIndex: 0.85,
      neighbourhoods: [
        ['Castletroy', 52.670, -8.555, 1, 1.05],
        ['Dooradoyle', 52.635, -8.650, 1, 1.0],
        ['Corbally', 52.675, -8.610, 1, 1.0],
        ['Raheen', 52.625, -8.660, 1, 0.95],
      ],
    },
  ],
};
