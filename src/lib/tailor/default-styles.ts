// Styles used when no template style can be read. Generated from the original Resume-Template.pdf and
// Coverletter-Template.pdf, so generated files keep the original look by default.
import type { CoverStyle, ResumeStyle } from "./template-style";

export const DEFAULT_RESUME_STYLE: ResumeStyle = {
  "kind": "resume",
  "page": {
    "width": 612,
    "height": 792,
    "top": 44.36,
    "bottom": 65.42,
    "left": 50,
    "right": 56.85
  },
  "header": {
    "name": {
      "font": {
        "family": "Helvetica",
        "generic": "sans-serif"
      },
      "bold": true,
      "italic": false,
      "size": 20,
      "color": "#1a1a1a",
      "upper": true,
      "align": "center",
      "base": 64.36
    },
    "contact": {
      "font": {
        "family": "Helvetica",
        "generic": "sans-serif"
      },
      "bold": false,
      "italic": false,
      "size": 9,
      "color": "#555555",
      "align": "center",
      "gap": 23.04,
      "separator": " | ",
      "separatorColor": "#555555",
      "linkColor": "#1f4e79"
    },
    "rule": {
      "color": "#1f4e79",
      "width": 1.2,
      "offset": 9.54
    }
  },
  "afterHeader": 30.66,
  "heading": {
    "font": {
      "family": "Helvetica",
      "generic": "sans-serif"
    },
    "bold": true,
    "italic": false,
    "size": 11,
    "color": "#1f4e79",
    "upper": true,
    "rule": {
      "color": "#222222",
      "width": 1,
      "offset": 8.19
    },
    "afterRule": 19.54,
    "gapAfter": 27.73,
    "sectionGap": 27.35
  },
  "labels": {
    "summary": "SUMMARY",
    "skills": "SKILLS",
    "experience": "EXPERIENCE",
    "education": "EDUCATION"
  },
  "order": [
    "summary",
    "skills",
    "experience",
    "education"
  ],
  "body": {
    "font": {
      "family": "Helvetica",
      "generic": "sans-serif"
    },
    "bold": false,
    "italic": false,
    "size": 10.5,
    "color": "#000000",
    "line": 14.49
  },
  "bold": {
    "font": {
      "family": "Helvetica",
      "generic": "sans-serif"
    },
    "bold": true,
    "italic": false,
    "size": 10.5,
    "color": "#000000"
  },
  "skill": {
    "label": {
      "font": {
        "family": "Helvetica",
        "generic": "sans-serif"
      },
      "bold": true,
      "italic": false,
      "size": 10.5,
      "color": "#000000"
    },
    "items": {
      "font": {
        "family": "Helvetica",
        "generic": "sans-serif"
      },
      "bold": true,
      "italic": false,
      "size": 10.5,
      "color": "#000000"
    },
    "line": 14.49,
    "entryGap": 18.87
  },
  "role": {
    "title": {
      "font": {
        "family": "Helvetica",
        "generic": "sans-serif"
      },
      "bold": true,
      "italic": false,
      "size": 11,
      "color": "#000000"
    },
    "meta": {
      "font": {
        "family": "Helvetica",
        "generic": "sans-serif"
      },
      "bold": false,
      "italic": true,
      "size": 10,
      "color": "#000000",
      "separator": " | ",
      "datesRight": false,
      "datesOn": "meta"
    },
    "dates": {
      "font": {
        "family": "Helvetica",
        "generic": "sans-serif"
      },
      "bold": false,
      "italic": true,
      "size": 10,
      "color": "#000000"
    },
    "overview": {
      "font": {
        "family": "Helvetica",
        "generic": "sans-serif"
      },
      "bold": false,
      "italic": true,
      "size": 10,
      "color": "#444444",
      "line": 13.56
    },
    "titleToMeta": 13.42,
    "metaToNext": 16.76,
    "overviewToBullet": 19.7,
    "roleGap": 27.24
  },
  "bullet": {
    "char": "•",
    "style": {
      "font": {
        "family": "Helvetica",
        "generic": "sans-serif"
      },
      "bold": false,
      "italic": false,
      "size": 10.5,
      "color": "#000000"
    },
    "bold": {
      "font": {
        "family": "Helvetica",
        "generic": "sans-serif"
      },
      "bold": true,
      "italic": false,
      "size": 10.5,
      "color": "#000000"
    },
    "bulletIndent": 0,
    "textIndent": 9.51,
    "wrapIndent": 0,
    "line": 14.14,
    "gap": 18.39
  },
  "education": {
    "degree": {
      "font": {
        "family": "Helvetica",
        "generic": "sans-serif"
      },
      "bold": true,
      "italic": false,
      "size": 11,
      "color": "#000000"
    },
    "school": {
      "font": {
        "family": "Helvetica",
        "generic": "sans-serif"
      },
      "bold": false,
      "italic": true,
      "size": 10,
      "color": "#000000",
      "separator": " | "
    },
    "degreeToSchool": 13.42,
    "entryGap": 25.52
  }
};

export const DEFAULT_COVER_STYLE: CoverStyle = {
  "kind": "cover",
  "page": {
    "width": 595.32,
    "height": 841.92,
    "top": 35.04,
    "bottom": 35.04,
    "left": 36,
    "right": 37.92
  },
  "header": {
    "name": {
      "font": {
        "family": "Calibri",
        "generic": "sans-serif"
      },
      "bold": true,
      "italic": false,
      "size": 20,
      "color": "#1a1a1a",
      "upper": true,
      "align": "center",
      "base": 55.02
    },
    "contact": {
      "font": {
        "family": "Calibri",
        "generic": "sans-serif"
      },
      "bold": false,
      "italic": false,
      "size": 9,
      "color": "#555555",
      "align": "center",
      "gap": 18.96,
      "separator": " · ",
      "separatorColor": "#555555",
      "linkColor": "#1f4e79"
    },
    "rule": {
      "color": "#1f4e79",
      "width": 1.5,
      "offset": 13.11
    }
  },
  "date": {
    "font": {
      "family": "Calibri",
      "generic": "sans-serif"
    },
    "bold": false,
    "italic": false,
    "size": 10,
    "color": "#000000",
    "gap": 18.33
  },
  "recipient": {
    "font": {
      "family": "Calibri",
      "generic": "sans-serif"
    },
    "bold": false,
    "italic": false,
    "size": 10,
    "color": "#000000",
    "gap": 22.2,
    "line": 15.26
  },
  "subject": {
    "font": {
      "family": "Calibri",
      "generic": "sans-serif"
    },
    "bold": true,
    "italic": false,
    "size": 10,
    "color": "#000000",
    "gap": 15.18
  },
  "body": {
    "font": {
      "family": "Calibri",
      "generic": "sans-serif"
    },
    "bold": false,
    "italic": false,
    "size": 10,
    "color": "#000000",
    "gap": 22.14,
    "line": 12.24,
    "paragraphGap": 20.16,
    "justify": false
  },
  "bold": {
    "font": {
      "family": "Calibri",
      "generic": "sans-serif"
    },
    "bold": true,
    "italic": false,
    "size": 10,
    "color": "#000000"
  },
  "closing": {
    "font": {
      "family": "Calibri",
      "generic": "sans-serif"
    },
    "bold": false,
    "italic": false,
    "size": 10,
    "color": "#000000",
    "gap": 20.18
  },
  "signature": {
    "font": {
      "family": "Calibri",
      "generic": "sans-serif"
    },
    "bold": true,
    "italic": false,
    "size": 10,
    "color": "#000000",
    "gap": 22.2
  }
};
