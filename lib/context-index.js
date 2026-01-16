/**
 * ContextIndex - Advanced indexing and search utilities
 *
 * Provides:
 * - Trigram-based fuzzy matching for description similarity
 * - Inverted index for fast keyword search
 * - LRU cache for frequently accessed items
 */

import { createHash } from 'crypto';

/**
 * Generate trigrams from text for fuzzy matching
 * @param {string} text
 * @returns {Set<string>}
 */
export function generateTrigrams(text) {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const trigrams = new Set();

  if (normalized.length < 3) {
    trigrams.add(normalized);
    return trigrams;
  }

  for (let i = 0; i <= normalized.length - 3; i++) {
    trigrams.add(normalized.slice(i, i + 3));
  }

  return trigrams;
}

/**
 * Calculate Jaccard similarity between two trigram sets
 * @param {Set<string>} set1
 * @param {Set<string>} set2
 * @returns {number} Similarity score 0-1
 */
export function trigramSimilarity(set1, set2) {
  if (set1.size === 0 || set2.size === 0) return 0;

  let intersection = 0;
  for (const t of set1) {
    if (set2.has(t)) intersection++;
  }

  const union = set1.size + set2.size - intersection;
  return intersection / union;
}

/**
 * Calculate text similarity using trigrams
 * @param {string} text1
 * @param {string} text2
 * @returns {number}
 */
export function textSimilarity(text1, text2) {
  const t1 = generateTrigrams(text1);
  const t2 = generateTrigrams(text2);
  return trigramSimilarity(t1, t2);
}

/**
 * Simple LRU Cache for frequently accessed items
 */
export class LRUCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return undefined;

    // Move to end (most recently used)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);

    return value;
  }

  set(key, value) {
    // If key exists, delete to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }

    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  get size() {
    return this.cache.size;
  }
}

/**
 * Inverted index for keyword search
 */
export class InvertedIndex {
  constructor() {
    this.index = new Map();  // word -> Set of document IDs
    this.documents = new Map();  // docId -> original doc
  }

  /**
   * Tokenize text into searchable words
   * @param {string} text
   * @returns {string[]}
   */
  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
  }

  /**
   * Add document to index
   * @param {string} docId
   * @param {object} doc
   * @param {string[]} fields - Fields to index
   */
  add(docId, doc, fields = ['description', 'file', 'type']) {
    this.documents.set(docId, doc);

    const words = new Set();

    for (const field of fields) {
      const value = doc[field];
      if (typeof value === 'string') {
        for (const word of this.tokenize(value)) {
          words.add(word);
        }
      }
    }

    for (const word of words) {
      if (!this.index.has(word)) {
        this.index.set(word, new Set());
      }
      this.index.get(word).add(docId);
    }
  }

  /**
   * Search for documents matching query
   * @param {string} query
   * @param {object} options
   * @returns {object[]}
   */
  search(query, options = {}) {
    const { limit = 50, minScore = 0 } = options;
    const queryWords = this.tokenize(query);

    if (queryWords.length === 0) return [];

    // Score documents by word matches
    const scores = new Map();

    for (const word of queryWords) {
      const matchingDocs = this.index.get(word);
      if (matchingDocs) {
        for (const docId of matchingDocs) {
          scores.set(docId, (scores.get(docId) || 0) + 1);
        }
      }

      // Also check partial matches
      for (const [indexedWord, docs] of this.index) {
        if (indexedWord.includes(word) || word.includes(indexedWord)) {
          for (const docId of docs) {
            scores.set(docId, (scores.get(docId) || 0) + 0.5);
          }
        }
      }
    }

    // Normalize scores and filter
    const results = [];
    for (const [docId, score] of scores) {
      const normalizedScore = score / queryWords.length;
      if (normalizedScore >= minScore) {
        results.push({
          ...this.documents.get(docId),
          _searchScore: normalizedScore,
        });
      }
    }

    // Sort by score and limit
    results.sort((a, b) => b._searchScore - a._searchScore);
    return results.slice(0, limit);
  }

  /**
   * Remove document from index
   * @param {string} docId
   */
  remove(docId) {
    const doc = this.documents.get(docId);
    if (!doc) return;

    // Remove from all word indexes
    for (const [, docs] of this.index) {
      docs.delete(docId);
    }

    this.documents.delete(docId);
  }

  /**
   * Rebuild index from documents
   */
  rebuild() {
    const docs = new Map(this.documents);
    this.index.clear();

    for (const [docId, doc] of docs) {
      this.add(docId, doc);
    }
  }

  /**
   * Get index statistics
   */
  stats() {
    return {
      documents: this.documents.size,
      uniqueWords: this.index.size,
      avgWordsPerDoc: this.documents.size > 0
        ? [...this.index.values()].reduce((sum, s) => sum + s.size, 0) / this.documents.size
        : 0,
    };
  }
}

/**
 * Bloom filter for fast duplicate detection
 * (Space-efficient probabilistic data structure)
 */
export class BloomFilter {
  constructor(size = 10000, hashCount = 3) {
    this.size = size;
    this.hashCount = hashCount;
    this.bits = new Uint8Array(Math.ceil(size / 8));
  }

  /**
   * Generate hash values for an item
   * @param {string} item
   * @returns {number[]}
   */
  _hashes(item) {
    const hashes = [];
    for (let i = 0; i < this.hashCount; i++) {
      const hash = createHash('sha256')
        .update(item + i.toString())
        .digest();

      // Get 4 bytes as unsigned int
      const value = hash.readUInt32BE(0) % this.size;
      hashes.push(value);
    }
    return hashes;
  }

  /**
   * Add item to filter
   * @param {string} item
   */
  add(item) {
    for (const hash of this._hashes(item)) {
      const byteIndex = Math.floor(hash / 8);
      const bitIndex = hash % 8;
      this.bits[byteIndex] |= (1 << bitIndex);
    }
  }

  /**
   * Check if item might exist
   * @param {string} item
   * @returns {boolean} True if possibly exists, false if definitely doesn't
   */
  mightContain(item) {
    for (const hash of this._hashes(item)) {
      const byteIndex = Math.floor(hash / 8);
      const bitIndex = hash % 8;
      if ((this.bits[byteIndex] & (1 << bitIndex)) === 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * Serialize to base64
   * @returns {string}
   */
  serialize() {
    return Buffer.from(this.bits).toString('base64');
  }

  /**
   * Deserialize from base64
   * @param {string} data
   * @returns {BloomFilter}
   */
  static deserialize(data, size = 10000, hashCount = 3) {
    const filter = new BloomFilter(size, hashCount);
    filter.bits = new Uint8Array(Buffer.from(data, 'base64'));
    return filter;
  }
}

/**
 * Find similar findings based on description and context
 * @param {object} finding - The finding to match
 * @param {object[]} candidates - Pool of candidates to search
 * @param {object} options
 * @returns {object[]} Sorted by similarity
 */
export function findSimilar(finding, candidates, options = {}) {
  const { threshold = 0.5, limit = 5, weights = {} } = options;

  const w = {
    description: weights.description || 0.5,
    file: weights.file || 0.2,
    type: weights.type || 0.2,
    lines: weights.lines || 0.1,
    ...weights,
  };

  const results = [];

  for (const candidate of candidates) {
    let score = 0;

    // Description similarity (trigram)
    if (finding.description && candidate.description) {
      score += w.description * textSimilarity(finding.description, candidate.description);
    }

    // File path similarity
    if (finding.file && candidate.file) {
      const fileSim = finding.file === candidate.file
        ? 1
        : finding.file.includes(candidate.file) || candidate.file.includes(finding.file)
          ? 0.5
          : 0;
      score += w.file * fileSim;
    }

    // Type exact match
    if (finding.type && candidate.type) {
      score += w.type * (finding.type === candidate.type ? 1 : 0);
    }

    // Line proximity
    if (finding.lines && candidate.lines) {
      const [start1] = finding.lines.split('-').map(Number);
      const [start2] = candidate.lines.split('-').map(Number);
      const distance = Math.abs(start1 - start2);
      const lineSim = Math.max(0, 1 - distance / 100);
      score += w.lines * lineSim;
    }

    if (score >= threshold) {
      results.push({
        ...candidate,
        _similarity: score,
      });
    }
  }

  return results
    .sort((a, b) => b._similarity - a._similarity)
    .slice(0, limit);
}

/**
 * Find Linear issues that match a finding
 * Used by goodflows_preflight_check to detect conflicts before creating issues
 * 
 * Match Types:
 * - exact_match: Same file AND high description similarity (>= threshold) - definitely a duplicate
 * - likely_duplicate: High description similarity (>= 0.7) even without file match
 * - same_file: Same file but different description - might be related, not duplicate
 * - similar: Moderate description similarity - needs review
 * 
 * @param {object} finding - { file, description, type }
 * @param {array} linearIssues - Issues from Linear API
 * @param {object} options - { threshold, includeStatus }
 * @returns {array} Matching issues with match type and similarity score
 */
export function findLinearMatches(finding, linearIssues, options = {}) {
  const { 
    threshold = 0.5,
    highThreshold = 0.7,  // For "likely_duplicate" classification
    includeStatus = ['Backlog', 'Todo', 'In Progress', 'backlog', 'todo', 'in progress', 'unstarted', 'started'],
  } = options;
  
  const matches = [];
  
  for (const issue of linearIssues) {
    // Filter by status if specified
    const issueStatus = issue.status || issue.state?.name || '';
    if (includeStatus.length > 0) {
      const statusLower = issueStatus.toLowerCase();
      const isValidStatus = includeStatus.some(s => s.toLowerCase() === statusLower);
      if (!isValidStatus) continue;
    }
    
    // 1. Check if file path is mentioned in issue
    const issueContent = `${issue.title || ''} ${issue.description || ''}`.toLowerCase();
    const findingFile = (finding.file || '').toLowerCase();
    const fileInIssue = findingFile && findingFile.length > 3 && issueContent.includes(findingFile);
    
    // Also check for partial file match (just filename without path)
    const fileName = findingFile.split('/').pop();
    const fileNameInIssue = fileName && fileName.length > 3 && issueContent.includes(fileName);
    
    // 2. Calculate description similarity
    const findingDesc = finding.description || '';
    const titleSimilarity = textSimilarity(findingDesc, issue.title || '');
    const descSimilarity = textSimilarity(findingDesc, issue.description || '');
    const maxSimilarity = Math.max(titleSimilarity, descSimilarity);
    
    // 3. Determine match type based on combination of file and description match
    let matchType = null;
    let matchScore = maxSimilarity;
    let isConflict = false;  // Whether this should block issue creation
    
    if (fileInIssue && maxSimilarity >= threshold) {
      // Same file + similar description = definite duplicate
      matchType = 'exact_match';
      matchScore = Math.min(1, maxSimilarity + 0.2);
      isConflict = true;
    } else if (maxSimilarity >= highThreshold) {
      // Very similar description even without file match = likely duplicate
      matchType = 'likely_duplicate';
      matchScore = maxSimilarity;
      isConflict = true;
    } else if ((fileInIssue || fileNameInIssue) && maxSimilarity >= 0.3) {
      // Same file but only moderate similarity = related but maybe not duplicate
      matchType = 'same_file';
      matchScore = Math.max(maxSimilarity, 0.3);
      isConflict = false;  // Don't block, just inform
    } else if (maxSimilarity >= threshold) {
      // Moderate similarity without file match = needs review
      matchType = 'similar';
      isConflict = false;  // Don't block, just inform
    }
    
    if (matchType) {
      matches.push({
        type: matchType,
        issue: {
          id: issue.identifier || issue.id,
          title: issue.title,
          status: issueStatus,
          url: issue.url,
          priority: issue.priority?.name || issue.priority,
          labels: Array.isArray(issue.labels) 
            ? issue.labels.map(l => typeof l === 'string' ? l : l.name).filter(Boolean)
            : [],
        },
        similarity: Math.round(matchScore * 100) / 100,
        matchedFile: fileInIssue || fileNameInIssue ? finding.file : null,
        matchedDescription: maxSimilarity >= threshold,
        isConflict,  // New field: indicates if this should block creation
      });
    }
  }
  
  // Sort by conflict status first, then by match quality
  const typeOrder = { exact_match: 0, likely_duplicate: 1, same_file: 2, similar: 3 };
  return matches.sort((a, b) => {
    // Conflicts first
    if (a.isConflict !== b.isConflict) return a.isConflict ? -1 : 1;
    // Then by type
    const typeDiff = typeOrder[a.type] - typeOrder[b.type];
    if (typeDiff !== 0) return typeDiff;
    // Then by similarity
    return b.similarity - a.similarity;
  });
}

/**
 * Get recommendation based on match type and action
 * @param {string} action - 'create_issue', 'fix_issue', 'review'
 * @param {object} match - Match result from findLinearMatches
 * @returns {string} 'skip' | 'link' | 'review' | 'proceed'
 */
export function getMatchRecommendation(action, match) {
  const { type, issue } = match;
  
  // For exact matches, always recommend skip or link
  if (type === 'exact_match') {
    if (action === 'create_issue') return 'skip';
    if (action === 'fix_issue') return issue.status === 'Done' ? 'skip' : 'proceed';
    return 'link';
  }
  
  // For same file matches, recommend review
  if (type === 'same_file') {
    if (action === 'create_issue') return 'link';
    return 'review';
  }
  
  // For similar matches, recommend review
  return 'review';
}

export default {
  generateTrigrams,
  trigramSimilarity,
  textSimilarity,
  LRUCache,
  InvertedIndex,
  BloomFilter,
  findSimilar,
  findLinearMatches,
  getMatchRecommendation,
};
