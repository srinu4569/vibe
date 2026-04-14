export interface Vybe {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export interface Question {
  id: number;
  text: string;
  options: string[];
}

export type AppStep = 'SELECT_VYBE' | 'MATCHING' | 'QUESTIONS' | 'RESULT' | 'CHAT';
