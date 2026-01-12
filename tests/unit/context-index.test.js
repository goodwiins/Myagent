/**
 * Unit tests for ContextIndex utilities
 */

import { describe, it, expect } from 'vitest';
import {
  generateTrigrams,
  trigramSimilarity,
  textSimilarity,
  LRUCache,
  InvertedIndex,
  BloomFilter,
  findSimilar,
  findLinearMatches,
  getMatchRecommendation,
} from '../../lib/context-index.js';

describe('generateTrigrams', () => {
  it('should generate trigrams from text', () => {
    const trigrams = generateTrigrams('hello');
    expect(trigrams).toContain('hel');
    expect(trigrams).toContain('ell');
    expect(trigrams).toContain('llo');
    expect(trigrams.size).toBe(3);
  });

  it('should normalize text to lowercase', () => {
    const trigrams = generateTrigrams('HELLO');
    expect(trigrams).toContain('hel');
  });

  it('should strip special characters', () => {
    const trigrams = generateTrigrams('he!lo');
    expect(trigrams).toContain('hel');
  });

  it('should handle short text', () => {
    const trigrams = generateTrigrams('ab');
    expect(trigrams).toContain('ab');
    expect(trigrams.size).toBe(1);
  });

  it('should handle empty text', () => {
    const trigrams = generateTrigrams('');
    expect(trigrams.size).toBe(1); // Contains empty string
  });
});

describe('trigramSimilarity', () => {
  it('should return 1 for identical sets', () => {
    const set = new Set(['abc', 'bcd', 'cde']);
    expect(trigramSimilarity(set, set)).toBe(1);
  });

  it('should return 0 for empty sets', () => {
    expect(trigramSimilarity(new Set(), new Set(['abc']))).toBe(0);
    expect(trigramSimilarity(new Set(['abc']), new Set())).toBe(0);
  });

  it('should return correct Jaccard similarity', () => {
    const set1 = new Set(['abc', 'bcd', 'cde']);
    const set2 = new Set(['abc', 'bcd', 'xyz']);
    // Intersection: 2, Union: 4
    expect(trigramSimilarity(set1, set2)).toBe(0.5);
  });
});

describe('textSimilarity', () => {
  it('should return high similarity for identical text', () => {
    const sim = textSimilarity('hello world', 'hello world');
    expect(sim).toBe(1);
  });

  it('should return moderate similarity for similar text', () => {
    const sim = textSimilarity('hardcoded API key', 'hardcoded secret key');
    expect(sim).toBeGreaterThan(0.3);
  });

  it('should return low similarity for different text', () => {
    const sim = textSimilarity('hello world', 'goodbye universe');
    expect(sim).toBeLessThan(0.2);
  });
});

describe('LRUCache', () => {
  it('should store and retrieve values', () => {
    const cache = new LRUCache(3);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
  });

  it('should evict oldest item when at capacity', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // Should evict 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('should update LRU order on get', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // Touch 'a', making 'b' oldest
    cache.set('c', 3); // Should evict 'b'
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
  });

  it('should return undefined for missing keys', () => {
    const cache = new LRUCache(3);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('should track size correctly', () => {
    const cache = new LRUCache(5);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
  });

  it('should support has/delete/clear', () => {
    const cache = new LRUCache(5);
    cache.set('a', 1);
    expect(cache.has('a')).toBe(true);
    cache.delete('a');
    expect(cache.has('a')).toBe(false);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe('InvertedIndex', () => {
  it('should index and search documents', () => {
    const index = new InvertedIndex();
    index.add('doc1', { description: 'hardcoded API key in code', file: 'auth.js', type: 'security' });
    index.add('doc2', { description: 'null pointer exception', file: 'utils.js', type: 'bug' });

    const results = index.search('API key');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file).toBe('auth.js');
  });

  it('should return empty for no matches', () => {
    const index = new InvertedIndex();
    index.add('doc1', { description: 'test', file: 'a.js', type: 'bug' });

    const results = index.search('nonexistent query');
    expect(results).toHaveLength(0);
  });

  it('should remove documents', () => {
    const index = new InvertedIndex();
    index.add('doc1', { description: 'test item', file: 'a.js', type: 'bug' });
    index.remove('doc1');

    const results = index.search('test');
    expect(results).toHaveLength(0);
  });

  it('should provide stats', () => {
    const index = new InvertedIndex();
    index.add('doc1', { description: 'test one', file: 'a.js', type: 'bug' });
    index.add('doc2', { description: 'test two', file: 'b.js', type: 'bug' });

    const stats = index.stats();
    expect(stats.documents).toBe(2);
    expect(stats.uniqueWords).toBeGreaterThan(0);
  });
});

describe('BloomFilter', () => {
  it('should add and check items', () => {
    const filter = new BloomFilter(1000, 3);
    filter.add('test-item');
    expect(filter.mightContain('test-item')).toBe(true);
  });

  it('should return false for items never added', () => {
    const filter = new BloomFilter(1000, 3);
    filter.add('item1');
    // Note: might have false positives, but 'completely-different' should usually be false
    // Using specific strings that are unlikely to collide
    expect(filter.mightContain('xyzzy-never-added-unique')).toBe(false);
  });

  it('should serialize and deserialize', () => {
    const filter = new BloomFilter(1000, 3);
    filter.add('test-item');

    const serialized = filter.serialize();
    const restored = BloomFilter.deserialize(serialized, 1000, 3);

    expect(restored.mightContain('test-item')).toBe(true);
  });
});

describe('findSimilar', () => {
  const candidates = [
    { description: 'Hardcoded API key in authentication module', file: 'auth.js', type: 'security' },
    { description: 'Hardcoded secret in config file', file: 'config.js', type: 'security' },
    { description: 'Null pointer exception in utility', file: 'utils.js', type: 'bug' },
  ];

  it('should find similar findings by description', () => {
    const finding = { description: 'Hardcoded API key found', file: 'test.js', type: 'security' };
    const results = findSimilar(finding, candidates, { threshold: 0.3 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file).toBe('auth.js'); // Most similar
  });

  it('should respect threshold', () => {
    const finding = { description: 'completely different topic xyz', file: 'test.js', type: 'bug' };
    const results = findSimilar(finding, candidates, { threshold: 0.8 });

    expect(results).toHaveLength(0);
  });

  it('should respect limit', () => {
    const finding = { description: 'Hardcoded key', file: 'test.js', type: 'security' };
    const results = findSimilar(finding, candidates, { threshold: 0.1, limit: 1 });

    expect(results).toHaveLength(1);
  });

  it('should sort by similarity descending', () => {
    const finding = { description: 'Hardcoded API key', file: 'test.js', type: 'security' };
    const results = findSimilar(finding, candidates, { threshold: 0.1 });

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]._similarity).toBeGreaterThanOrEqual(results[i]._similarity);
    }
  });
});

describe('findLinearMatches', () => {
  const linearIssues = [
    {
      identifier: 'GOO-1',
      title: 'Hardcoded API key in auth.js',
      description: 'Found hardcoded API key in authentication module',
      status: 'Backlog',
      url: 'https://linear.app/test/GOO-1',
      priority: { name: 'High' },
      labels: [{ name: 'security' }],
    },
    {
      identifier: 'GOO-2',
      title: 'Fix null pointer in utils',
      description: 'Null pointer exception in utility function',
      status: 'In Progress',
      url: 'https://linear.app/test/GOO-2',
      priority: { name: 'Medium' },
      labels: [],
    },
    {
      identifier: 'GOO-3',
      title: 'Add unit tests',
      description: 'Need to add unit tests for new features',
      status: 'Done',
      url: 'https://linear.app/test/GOO-3',
      priority: { name: 'Low' },
      labels: [{ name: 'testing' }],
    },
  ];

  it('should find exact match when file and description match', () => {
    const finding = {
      file: 'auth.js',
      description: 'Hardcoded API key found in authentication',
      type: 'security',
    };

    const matches = findLinearMatches(finding, linearIssues, { threshold: 0.4 });

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].type).toBe('exact_match');
    expect(matches[0].issue.id).toBe('GOO-1');
    expect(matches[0].isConflict).toBe(true);
  });

  it('should find likely_duplicate for high similarity without file match', () => {
    const finding = {
      file: 'other.js',
      description: 'Hardcoded API key in authentication module',
      type: 'security',
    };

    const matches = findLinearMatches(finding, linearIssues, { threshold: 0.4, highThreshold: 0.6 });

    const likelyDupe = matches.find(m => m.type === 'likely_duplicate');
    expect(likelyDupe).toBeDefined();
    expect(likelyDupe.isConflict).toBe(true);
  });

  it('should find same_file match when file matches but description differs', () => {
    const finding = {
      file: 'auth.js',
      description: 'Memory leak in authentication module',  // Different but still meets 0.3 threshold
      type: 'bug',
    };

    const matches = findLinearMatches(finding, linearIssues, { threshold: 0.5 });

    // Since description similarity is moderate (~0.3-0.4), it should be classified as same_file
    const sameFile = matches.find(m => m.type === 'same_file');
    expect(sameFile).toBeDefined();
    expect(sameFile.issue.id).toBe('GOO-1');
    expect(sameFile.isConflict).toBe(false);
  });

  it('should filter by status', () => {
    const finding = {
      file: 'utils.js',
      description: 'Null pointer exception',
      type: 'bug',
    };

    // Exclude "Done" status
    const matches = findLinearMatches(finding, linearIssues, {
      threshold: 0.3,
      includeStatus: ['Backlog', 'In Progress'],
    });

    const doneMatch = matches.find(m => m.issue.id === 'GOO-3');
    expect(doneMatch).toBeUndefined();
  });

  it('should return empty array when no matches found', () => {
    const finding = {
      file: 'completely-different.js',
      description: 'Totally unrelated description xyz abc',
      type: 'docs',
    };

    const matches = findLinearMatches(finding, linearIssues, { threshold: 0.5 });

    expect(matches).toHaveLength(0);
  });

  it('should sort conflicts first, then by match type and similarity', () => {
    const finding = {
      file: 'auth.js',
      description: 'Hardcoded API key in authentication',
      type: 'security',
    };

    const matches = findLinearMatches(finding, linearIssues, { threshold: 0.3 });

    // First match should be a conflict
    if (matches.length > 0) {
      const firstConflictIdx = matches.findIndex(m => m.isConflict);
      const firstNonConflictIdx = matches.findIndex(m => !m.isConflict);

      if (firstConflictIdx !== -1 && firstNonConflictIdx !== -1) {
        expect(firstConflictIdx).toBeLessThan(firstNonConflictIdx);
      }
    }
  });

  it('should extract issue metadata correctly', () => {
    const finding = {
      file: 'auth.js',
      description: 'Hardcoded API key',
      type: 'security',
    };

    const matches = findLinearMatches(finding, linearIssues, { threshold: 0.3 });
    const match = matches.find(m => m.issue.id === 'GOO-1');

    expect(match).toBeDefined();
    expect(match.issue.title).toBe('Hardcoded API key in auth.js');
    expect(match.issue.status).toBe('Backlog');
    expect(match.issue.url).toBe('https://linear.app/test/GOO-1');
    expect(match.issue.priority).toBe('High');
    expect(match.issue.labels).toContain('security');
  });

  it('should handle issues with state.name instead of status', () => {
    const issuesWithState = [
      {
        identifier: 'GOO-10',
        title: 'Test issue',
        description: 'Test description with specific keywords',
        state: { name: 'Todo' },
        url: 'https://linear.app/test/GOO-10',
      },
    ];

    const finding = {
      file: 'test.js',
      description: 'Test description with specific keywords',
      type: 'bug',
    };

    const matches = findLinearMatches(finding, issuesWithState, {
      threshold: 0.5,
      includeStatus: ['Todo'],
    });

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].issue.status).toBe('Todo');
  });
});

describe('getMatchRecommendation', () => {
  it('should recommend skip for exact_match on create_issue', () => {
    const match = { type: 'exact_match', issue: { status: 'Backlog' } };
    expect(getMatchRecommendation('create_issue', match)).toBe('skip');
  });

  it('should recommend proceed for exact_match on fix_issue when not done', () => {
    const match = { type: 'exact_match', issue: { status: 'In Progress' } };
    expect(getMatchRecommendation('fix_issue', match)).toBe('proceed');
  });

  it('should recommend skip for exact_match on fix_issue when done', () => {
    const match = { type: 'exact_match', issue: { status: 'Done' } };
    expect(getMatchRecommendation('fix_issue', match)).toBe('skip');
  });

  it('should recommend link for exact_match on review', () => {
    const match = { type: 'exact_match', issue: { status: 'Backlog' } };
    expect(getMatchRecommendation('review', match)).toBe('link');
  });

  it('should recommend link for same_file on create_issue', () => {
    const match = { type: 'same_file', issue: { status: 'Backlog' } };
    expect(getMatchRecommendation('create_issue', match)).toBe('link');
  });

  it('should recommend review for same_file on fix_issue', () => {
    const match = { type: 'same_file', issue: { status: 'Backlog' } };
    expect(getMatchRecommendation('fix_issue', match)).toBe('review');
  });

  it('should recommend review for similar matches', () => {
    const match = { type: 'similar', issue: { status: 'Backlog' } };
    expect(getMatchRecommendation('create_issue', match)).toBe('review');
    expect(getMatchRecommendation('fix_issue', match)).toBe('review');
    expect(getMatchRecommendation('review', match)).toBe('review');
  });
});
