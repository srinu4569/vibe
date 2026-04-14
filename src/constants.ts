import { Vybe, Question } from './types';

export const VYBES: Vybe[] = [
  { id: 'happy', name: 'Happy', icon: 'Sun', color: 'text-yellow-400' },
  { id: 'chill', name: 'Chill', icon: 'Moon', color: 'text-indigo-400' },
  { id: 'party', name: 'Party', icon: 'Music', color: 'text-pink-400' },
  { id: 'deeptalk', name: 'Deep Talk', icon: 'Heart', color: 'text-red-400' },
  { id: 'curious', name: 'Curious', icon: 'Search', color: 'text-green-400' }
];

export const QUESTIONS: Question[] = [
  { id: 1, text: 'Coffee or Tea?', options: ['Coffee', 'Tea'] },
  { id: 2, text: 'Night Owl or Early Bird?', options: ['Night Owl', 'Early Bird'] },
  { id: 3, text: 'Beach or Mountains?', options: ['Beach', 'Mountains'] },
  { id: 4, text: 'Dog or Cat?', options: ['Dog', 'Cat'] },
  { id: 5, text: 'Movie or Music?', options: ['Movie', 'Music'] }
];
