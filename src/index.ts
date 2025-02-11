// Tailwind CSS Runtime API
// -----------------------------------------------------------------------------

const defaultOptions = {
  tailwind: undefined as CSSStyleSheet,
  // TODO: Add more options...
};

type TainwindRuntimeOptions = Partial<typeof defaultOptions>;

export class TailwindRuntime {
  /**
   * The CSSStyleSheet object containing tailwind
   */
  tailwind: CSSStyleSheet;

  /**
   * The CSSStyleDeclaration object containing all tailwind theme values
   */
  themeDeclaration?: CSSStyleDeclaration;

  /**
   * Shortcut for `getThemeNamespace('color')`
   */
  colors: Record<string, string> = {};

  /**
   * Shortcut for `getThemeNamespace('breakpoint')`
   */
  breakpoints: Record<string, string> = {};

  /**
   * The CSSLayerBlockRule containing all utility class definitions
   */
  utilitiesLayer?: CSSLayerBlockRule;

  /**
   * All options used to construct this instance, except for the tailwind
   * stylesheet which has it's own property (`tailwind`)
   */
  options: Omit<TainwindRuntimeOptions, 'tailwind'>;

  constructor(options: TainwindRuntimeOptions = defaultOptions) {
    let { tailwind, ...otherOptions } = options;

    // If no tailwind stylesheet is provided, try to find one
    // Find the first stylesheet with a `utilities` or `theme` layer block

    if (!tailwind) {
      tailwind = Array.from(document.styleSheets)
        .filter((sheet) => sheet instanceof CSSStyleSheet)
        .find((sheet) => {
          const rules = Array.from(sheet.cssRules);
          return rules.some((rule) => {
            if (rule instanceof CSSLayerBlockRule) {
              if (rule.name === 'utilities') return true;
              if (rule.name === 'theme') return true;
            }
          });
        });
      if (!tailwind) {
        throw new Error('Tailwind stylesheet could not be found automatically');
      }
    }

    if (!tailwind) {
      throw new Error('Tailwind runtime requires a tailwind stylesheet');
    }

    this.tailwind = tailwind;
    this.options = otherOptions;

    const theme = this.findLayerRule('theme')?.cssRules[0];
    if (theme instanceof CSSStyleRule) {
      this.themeDeclaration = theme.style;
      this.colors = this.themeNamespace('color');
      this.breakpoints = this.themeNamespace('breakpoint');
    }

    this.utilitiesLayer = this.findLayerRule('utilities');
  }

  /**
   * Create a proxy for accessing values in a tailwind theme namespace
   *
   * - Accessing a property will return the value of the corresponding CSS variable in the namespace
   * - Use `Object.keys` and `Object.entries` on the returned object to get all known values
   *
   * @param name The name of the theme namespace, like `color` or `breakpoint`, without the `--` prefix
   */
  themeNamespace(name: string) {
    const prefix = `--${name}-`;
    const get = (key: string) => {
      return this.themeDeclaration?.getPropertyValue(prefix + key);
    };
    return new Proxy({} as Record<string, string>, {
      get: (_, key) => get(key.toString()),
      has: (_, key) => get(key.toString()) !== undefined,
      ownKeys: () => {
        if (this.themeDeclaration) {
          return Array.from(this.themeDeclaration)
            .filter((key) => key.startsWith(prefix))
            .map((key) => key.slice(prefix.length));
        }
        return [];
      },
      getOwnPropertyDescriptor: (_, key) => {
        if (get(key.toString())) {
          return { enumerable: true, configurable: true };
        }
      },
    });
  }

  get activeBreakpoints() {
    let active: string[] = [];
    for (const [name, size] of Object.entries(this.breakpoints)) {
      if (window.matchMedia(`(min-width: ${size})`).matches) {
        active.push(name);
      }
    }
    return active;
  }

  /**
   * Try to find a custom property definition by name
   *
   * These are used for internal tailwind values, like `--tw-scale-x`
   */
  findPropertyRule(name: string) {
    for (const rule of this.tailwind.cssRules) {
      if (rule instanceof CSSPropertyRule && rule.name == name) {
        return rule;
      }
    }
  }

  /**
   * Find a layer rule in the tailwind stylesheet by name
   */
  findLayerRule(name: string) {
    for (const rule of this.tailwind.cssRules) {
      if (rule instanceof CSSLayerBlockRule && rule.name == name) {
        return rule;
      }
    }
  }

  /**
   * Iterate over all known utility class definitions
   */
  *allUtilityRules() {
    for (const rule of this.utilitiesLayer?.cssRules ?? []) {
      if (rule instanceof CSSStyleRule) yield rule;
    }
  }

  /*
   * Find a utility class definition by name
   */
  findUtilityRule(name: string) {
    for (const utility of this.allUtilityRules()) {
      if (cleanSelector(utility.selectorText) == name) return utility;
    }
  }

  /**
   * Find the value of a CSS variable in the tailwind stylesheet
   *
   * Works for theme values, like `--color-red-500` and `--spacing`, and for custom properties
   * used internally by tailwind (all start with `--tw-`)
   *
   * @param name The name of the value to look for, should start with `--`
   * @returns The value if found (may be `null`), or `undefined`
   */
  getValue(name: string) {
    if (!name.startsWith('--')) {
      throw new Error('CSS variable name must start with "--"');
    }

    if (this.themeDeclaration) {
      const value = this.themeDeclaration.getPropertyValue(name);
      if (value !== '') return value;
    }

    const prop = this.findPropertyRule(name);
    if (prop && !prop.inherits && prop.name == name) {
      return prop.initialValue;
    }
  }

  /**
   * Converts a set of utility class names to a inline style string
   *
   * @param classNames A list, or a space-separated string, of class names
   * @param state A list of active variants, like `['hover', 'focus']`
   * @param strict If true, only classes with exactly matching variants will be included
   */
  toCSS(classNames: string | string[], state: string[] = [], strict = false) {
    const pairs = Object.entries(this.toObject(classNames, state, strict)).map(
      ([key, value]) => `${toKebabCase(key)}: ${value}`
    );
    return pairs.join('; ') + ';';
  }

  /**
   * Converts a set of utility class names to a inline style object
   *
   * @param classNames A list, or a space-separated string, of class names
   * @param state A list of active variants, like `['hover', 'focus']`
   * @param strict If true, only classes with exactly matching variants will be included
   */
  toObject(
    classNames: string | string[],
    state: string[] = [],
    strict = false
  ) {
    // Normalize classNames to a list
    if (!Array.isArray(classNames)) classNames = classNames.split(' ');
    classNames = classNames.map((c) => c.trim()).filter(Boolean);

    const active = classNames.filter((c) => testVariants(c, state, strict));

    const style: Record<string, string> = {};

    // Ensure consistent ordering by iterating over the rules in the stylesheet
    for (const rule of this.allUtilityRules()) {
      const name = cleanSelector(rule.selectorText);
      if (active.includes(name)) collapseRule(rule, style);
    }

    this.substitute(style);

    for (const [key, value] of Object.entries(style)) {
      style[key] = simplify(value);
    }

    return style;
  }

  /**
   * Replace all `var(--name)` references in a style object with their resolved values if possible,
   * and remove redundant definitions from the object after substitution.
   *
   * - Keys matching known, non-inherited custom properties will be removed
   * - keys matching theme values will be left as-is, to preserve scoping
   */
  private substitute(style: Record<string, string>) {
    for (let [key, value] of Object.entries(style)) {
      for (const [_, varName] of value.matchAll(/var\((--[^),]+),?\)/g)) {
        const resolved = style[varName] ?? this.getValue(varName);
        if (resolved !== undefined) {
          const regex = new RegExp(`var\\(${varName}\,?\\)(\\s*)`);
          value = value.replace(regex, resolved ? `${resolved}$1` : '');
        }
      }
      style[key] = value.trim();
    }

    for (const key of Object.keys(style)) {
      const prop = this.findPropertyRule(key);
      if (prop && !prop.inherits) delete style[key];
    }
  }
}

// Utility functions
// -----------------------------------------------------------------------------

/**
 * Replaces all instances of `calc({number}{unit} * {number})` with the result
 */
function simplify(cssValue: string) {
  const regex = /calc\(([\d.]+)([a-z]+) \* ([\d.]+)\)/g;
  return cssValue.replace(regex, (_, a, unit, b) => {
    return `${parseFloat(a) * parseFloat(b)}${unit}`;
  });
}

/**
 * Is this rule a grouping rule, like a media query or keyframe?
 */
function isGroupRule(r: CSSRule): r is CSSGroupingRule {
  return 'cssRules' in r;
}

/**
 * Does this rule contain style declarations?
 */
function isStyleRule(r: CSSRule) {
  return r instanceof CSSStyleRule || r instanceof CSSNestedDeclarations;
}

/**
 * Test if a class name has all the required variants
 */
function testVariants(className: string, state: string[], strict = false) {
  // Find all `:` not between square brackets and remove the last part
  const parts = className.split(/\:(?![^\[]*\])/g);
  parts.pop();

  // If strict, the variants and state must be exactly the same
  if (strict && parts.length !== state.length) return false;

  for (const variant of parts) {
    if (!state.includes(variant)) return false;
  }

  return true;
}

function toCamelCase(name: string) {
  return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function toKebabCase(name: string) {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * Get the un-escaped name of a class selector without the leading dot
 */
function cleanSelector(selector: string) {
  return selector.replace(/\\/g, '').slice(1);
}

/**
 * Recursively collapse a CSS rule into a flat style object
 *
 * All nested rules will have their selectors and conditions stripped
 */
function collapseRule(rule: CSSRule, target: Record<string, string>) {
  if (isGroupRule(rule) && rule.cssRules.length) {
    for (const subRule of rule.cssRules) collapseRule(subRule, target);
  }

  if (isStyleRule(rule)) {
    const lines = rule.style.cssText.split(';').filter(Boolean);
    for (const part of lines) {
      let [key, value] = part.split(':').map((s) => s.trim());
      if (!key.startsWith('--')) key = toCamelCase(key);
      target[key] = value;
    }
  }
}
