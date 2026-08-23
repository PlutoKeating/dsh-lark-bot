import { describe, expect, it } from 'vitest';
import {
  COMMAND_CATALOG,
  assertCommandCatalogMatches,
  renderCommandHelp,
  renderSkillCommandIndex,
} from '../../src/commands/catalog.js';

describe('command catalog', () => {
  it('generates help and the skill index from the same complete registry', () => {
    const names = COMMAND_CATALOG.flatMap((entry) => entry.names);
    for (const name of names) {
      expect(renderCommandHelp('zh')).toContain(`\`${name}`);
      expect(renderCommandHelp('en')).toContain(`\`${name}`);
      expect(renderSkillCommandIndex()).toContain(`\`${name}`);
    }
    expect(names).toContain('/secret');
    expect(names).toContain('/language');
  });

  it('rejects handler/help drift in either direction', () => {
    const names = COMMAND_CATALOG.flatMap((entry) => entry.names);
    expect(() => assertCommandCatalogMatches(names)).not.toThrow();
    expect(() => assertCommandCatalogMatches(names.slice(1))).toThrow('command catalog drift');
    expect(() => assertCommandCatalogMatches([...names, '/ghost'])).toThrow('command catalog drift');
  });
});
