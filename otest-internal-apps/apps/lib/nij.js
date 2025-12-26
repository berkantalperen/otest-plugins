// nij.js — NIJ computation (no DOM)

// Critical intercepts (Fzc, Myc) for various dummies.
// Sign convention used in nijSeries: Fzc and Myc are positive magnitudes.
// +Fz = tension, −Fz = compression; +My = flexion, −My = extension.

// Sources:
// - Hybrid III 50th (FMVSS 208): Fzc_T=6806 N, Fzc_C=6160 N, Myc_FLEX=310 Nm, Myc_EXT=135 Nm
//   (49 CFR 571.208 S6.6; LII summary). 
// - Hybrid III 5th female: Fzc_T=4287 N, Fzc_C=3880 N, Myc_FLEX=155 Nm, Myc_EXT=67 Nm
//   (NI DIAdem docs table for in-position tests).
// - Hybrid III 95th male: Fzc_T=5440 N, Fzc_C=5440 N, Myc_FLEX=415 Nm, Myc_EXT=166 Nm
//   (NHTSA “Development of Improved Injury Criteria…”, Table ES.2).
// - THOR-50M: Fzc_T=4200 N, Fzc_C=4520 N, Myc_FLEX=60.0 Nm, Myc_EXT=79.2 Nm
//   (NHTSA docket “Injury Criteria for the THOR-50th Male ATD”).

export const NIJ_CONSTANTS = {
  HIII50: {            // Hybrid III 50th (FMVSS 208)
    FZC_T: 6806,
    FZC_C: 6160,
    MYC_FLEX: 310,
    MYC_EXT: 135
  },
  HIII5F: {            // Hybrid III 5th Female
    FZC_T: 4287,
    FZC_C: 3880,
    MYC_FLEX: 155,
    MYC_EXT: 67
  },
  HIII95: {            // Hybrid III 95th Male
    FZC_T: 5440,
    FZC_C: 5440,
    MYC_FLEX: 415,
    MYC_EXT: 166
  },
  THOR50M: {           // THOR-50M (upper-neck based Nij)
    FZC_T: 4200,
    FZC_C: 4520,
    MYC_FLEX: 60.0,
    MYC_EXT: 79.2
  }
};

// Helper for UI: id → label
export const STANDARDS = [
  { id: 'hiii50',  label: 'Hybrid III 50th (FMVSS 208)' },
  { id: 'hiii5f',  label: 'Hybrid III 5th Female' },
  { id: 'hiii95',  label: 'Hybrid III 95th Male' },
  { id: 'thor50m', label: 'THOR-50M' }
];

export function getNijConstants(id = 'hiii50') {
  switch (String(id).toLowerCase()) {
    case 'hiii5f':  return NIJ_CONSTANTS.HIII5F;
    case 'hiii95':  return NIJ_CONSTANTS.HIII95;
    case 'thor50m': return NIJ_CONSTANTS.THOR50M;
    case 'hiii50':
    default:        return NIJ_CONSTANTS.HIII50;
  }
}

/**
 * Build NIJ time series from Fz [N] and My [N·m].
 * Sign convention: +Fz=tension, −Fz=compression; +My=flexion, −My=extension.
 * Returns { NijTF, NijTE, NijCF, NijCE } arrays.
 */
export function nijSeries(Fz, My, C = NIJ_CONSTANTS.HIII50) {
  const n = Math.min(Fz?.length ?? 0, My?.length ?? 0);
  const NijTF = new Array(n);
  const NijTE = new Array(n);
  const NijCF = new Array(n);
  const NijCE = new Array(n);

  const { FZC_T, FZC_C, MYC_FLEX, MYC_EXT } = C;

  for (let i = 0; i < n; i++) {
    const fz = Fz[i];
    const my = My[i];

    const Ft = Math.max(+fz, 0); // tension (+)
    const Fc = Math.max(-fz, 0); // compression (−)
    const Mf = Math.max(+my, 0); // flexion (+)
    const Me = Math.max(-my, 0); // extension (−)

    NijTF[i] = Ft / FZC_T + Mf / MYC_FLEX; // tension + flexion
    NijTE[i] = Ft / FZC_T + Me / MYC_EXT;  // tension + extension
    NijCF[i] = Fc / FZC_C + Mf / MYC_FLEX; // compression + flexion
    NijCE[i] = Fc / FZC_C + Me / MYC_EXT;  // compression + extension
  }

  return { NijTF, NijTE, NijCF, NijCE };
}
