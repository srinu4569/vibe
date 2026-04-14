/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sun, 
  Moon, 
  Music, 
  Heart, 
  Search, 
  ChevronRight, 
  Loader2, 
  HeartHandshake, 
  XCircle, 
  MessageCircle, 
  Send,
  ArrowLeft,
  LogOut
} from 'lucide-react';
import { auth, db } from './lib/firebase';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged,
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  collection, 
  onSnapshot, 
  query, 
  where, 
  addDoc, 
  serverTimestamp,
  updateDoc,
  getDocs,
  limit,
  orderBy,
  Timestamp
} from 'firebase/firestore';
import { VYBES, QUESTIONS } from './constants';
import { Vybe, AppStep } from './types';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const IconMap: Record<string, React.ElementType> = {
  Sun,
  Moon,
  Music,
  Heart,
  Search
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<AppStep>('SELECT_VYBE');
  const [selectedVybe, setSelectedVybe] = useState<Vybe | null>(null);
  const [matchSession, setMatchSession] = useState<any>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [matchResult, setMatchResult] = useState<{ success: boolean; score: number } | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        setStep('SELECT_VYBE');
        // Sync user profile
        const userPath = `users/${u.uid}`;
        setDoc(doc(db, userPath), {
          username: u.displayName,
          email: u.email,
          photoURL: u.photoURL,
          status: 'online',
          lastSeen: serverTimestamp()
        }, { merge: true }).catch(err => handleFirestoreError(err, OperationType.WRITE, userPath));
      } else {
        setStep('AUTH');
      }
    });
    return unsubscribe;
  }, []);

  // Match Listener
  useEffect(() => {
    if (!user || step !== 'MATCHING') return;

    const path = 'match_sessions';
    const q = query(
      collection(db, path),
      where('status', '==', 'active'),
      where('vybeId', '==', selectedVybe?.id),
      where('participants', 'array-contains', user.uid),
      orderBy('createdAt', 'desc'),
      limit(1)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        setMatchSession({ id: doc.id, ...data });
        setStep('QUESTIONS');
      });
    }, (err) => handleFirestoreError(err, OperationType.LIST, path));

    return unsubscribe;
  }, [user, step, selectedVybe]);

  // Answers Listener
  useEffect(() => {
    if (!matchSession || step !== 'QUESTIONS') return;

    const path = `match_sessions/${matchSession.id}`;
    const unsubscribe = onSnapshot(doc(db, path), (doc) => {
      const data = doc.data();
      if (data?.status === 'completed' || data?.status === 'failed') {
        setMatchResult({ 
          success: data.status === 'completed', 
          score: data.matchScore || 0 
        });
        setStep('RESULT');
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, path));

    return unsubscribe;
  }, [matchSession, step]);

  // Chat Listener
  useEffect(() => {
    if (!matchSession || step !== 'CHAT') return;

    const path = `match_sessions/${matchSession.id}/messages`;
    const q = query(
      collection(db, path),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => handleFirestoreError(err, OperationType.LIST, path));

    return unsubscribe;
  }, [matchSession, step]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setStep('SELECT_VYBE');
  };

  const handleSelectVybe = async (vybe: Vybe) => {
    if (!user) {
      await handleLogin();
      return;
    }
    setSelectedVybe(vybe);
    setStep('MATCHING');

    // Create Vybe Session
    const startTime = new Date();
    const expiryTime = new Date(startTime.getTime() + 24 * 60 * 60 * 1000);
    
    const sessionPath = 'user_vybe_sessions';
    try {
      await addDoc(collection(db, sessionPath), {
        userId: user.uid,
        vybeId: vybe.id,
        startTime: Timestamp.fromDate(startTime),
        expiryTime: Timestamp.fromDate(expiryTime),
        status: 'active'
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, sessionPath);
    }

    // Try to find a match (simplified matching logic)
    const q = query(
      collection(db, sessionPath),
      where('vybeId', '==', vybe.id),
      where('status', '==', 'active'),
      where('userId', '!=', user.uid),
      limit(1)
    );

    try {
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const otherUserSession = snapshot.docs[0].data();
        const matchId = [user.uid, otherUserSession.userId].sort().join('_');
        
        const matchPath = `match_sessions/${matchId}`;
        await setDoc(doc(db, matchPath), {
          user1Id: user.uid,
          user2Id: otherUserSession.userId,
          participants: [user.uid, otherUserSession.userId],
          vybeId: vybe.id,
          status: 'active',
          createdAt: serverTimestamp(),
          questions: QUESTIONS.map(q => q.id),
          answers: {}
        });

        // Update session statuses
        await updateDoc(doc(db, 'user_vybe_sessions', snapshot.docs[0].id), { status: 'matched' });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, sessionPath);
    }
  };

  const handleSubmitAnswer = async (answer: string) => {
    if (!matchSession || !user) return;

    const questionId = QUESTIONS[currentQuestionIndex].id;
    const answerPath = `match_sessions/${matchSession.id}/answers`;
    const answerRef = doc(collection(db, answerPath));
    
    try {
      await setDoc(answerRef, {
        matchId: matchSession.id,
        userId: user.uid,
        questionId,
        answer,
        answeredAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, answerPath);
    }

    setUserAnswers(prev => ({ ...prev, [questionId]: answer }));

    if (currentQuestionIndex < QUESTIONS.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else {
      // Check if both users answered all questions
      try {
        const answersSnapshot = await getDocs(collection(db, answerPath));
        const allAnswers = answersSnapshot.docs.map(d => d.data());
        
        const user1Answers = allAnswers.filter(a => a.userId === matchSession.user1Id);
        const user2Answers = allAnswers.filter(a => a.userId === matchSession.user2Id);

        if (user1Answers.length === 5 && user2Answers.length === 5) {
          let score = 0;
          QUESTIONS.forEach(q => {
            const a1 = user1Answers.find(a => a.questionId === q.id)?.answer;
            const a2 = user2Answers.find(a => a.questionId === q.id)?.answer;
            if (a1 === a2) score++;
          });

          await updateDoc(doc(db, 'match_sessions', matchSession.id), {
            status: score >= 3 ? 'completed' : 'failed',
            matchScore: score
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, answerPath);
      }
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !matchSession || !user) return;

    const messagePath = `match_sessions/${matchSession.id}/messages`;
    try {
      await addDoc(collection(db, messagePath), {
        text: newMessage,
        userId: user.uid,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, messagePath);
    }

    setNewMessage('');
  };

  const reset = () => {
    setStep('SELECT_VYBE');
    setCurrentQuestionIndex(0);
    setUserAnswers({});
    setSelectedVybe(null);
    setMatchSession(null);
    setMatchResult(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col max-w-md mx-auto border-x border-zinc-800 shadow-2xl overflow-hidden relative">
      {/* Header */}
      <header className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-2">
          {step !== 'SELECT_VYBE' && (
            <button onClick={reset} className="p-1 hover:bg-zinc-800 rounded-full transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <h1 className="font-bold text-xl tracking-tight">Vybe Connect</h1>
        </div>
        <div className="flex items-center gap-3">
          {selectedVybe && (
            <div className="flex items-center gap-1.5 bg-green-500/10 text-green-400 px-2.5 py-1 rounded-full text-xs font-medium border border-green-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              {selectedVybe.name} Active
            </div>
          )}
          {user && (
            <button onClick={handleLogout} className="p-1.5 hover:bg-red-500/10 text-zinc-500 hover:text-red-400 rounded-lg transition-all">
              <LogOut className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 p-6 overflow-y-auto">
        <AnimatePresence mode="wait">
          {/* STEP 0: AUTH */}
          {step === 'AUTH' && (
            <motion.div 
              key="auth"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.1 }}
              className="h-full flex flex-col items-center justify-center text-center space-y-8 py-12"
            >
              <div className="relative">
                <div className="absolute inset-0 bg-blue-500/20 blur-3xl rounded-full" />
                <div className="relative bg-zinc-900 p-6 rounded-3xl border border-zinc-800 shadow-2xl">
                  <HeartHandshake className="w-16 h-16 text-blue-500" />
                </div>
              </div>
              
              <div className="space-y-3">
                <h2 className="text-3xl font-black tracking-tight">Connect by Vybe</h2>
                <p className="text-zinc-400 max-w-[280px] mx-auto">
                  Find people who share your current mood and emotional context.
                </p>
              </div>

              <button 
                onClick={handleLogin}
                className="w-full py-4 bg-white text-black hover:bg-zinc-200 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 transition-all active:scale-[0.98] shadow-xl"
              >
                <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
                Continue with Google
              </button>

              <p className="text-xs text-zinc-500">
                By continuing, you agree to our Terms and Privacy Policy.
              </p>
            </motion.div>
          )}

          {/* STEP 1: SELECT VYBE */}
          {step === 'SELECT_VYBE' && (
            <motion.div 
              key="select"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div>
                <h2 className="text-2xl font-bold mb-2">What's your mood?</h2>
                <p className="text-zinc-400">Connect with others in the same emotional context.</p>
              </div>
              
              <div className="space-y-3">
                {VYBES.map((v) => {
                  const Icon = IconMap[v.icon];
                  return (
                    <button
                      key={v.id}
                      onClick={() => handleSelectVybe(v)}
                      className="w-full flex items-center gap-4 p-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-2xl transition-all active:scale-[0.98] group"
                    >
                      <div className={`p-3 rounded-xl bg-zinc-950 ${v.color}`}>
                        <Icon className="w-6 h-6" />
                      </div>
                      <span className="flex-1 text-left font-semibold text-lg">{v.name}</span>
                      <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* STEP 2: MATCHING */}
          {step === 'MATCHING' && (
            <motion.div 
              key="matching"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="h-full flex flex-col items-center justify-center text-center space-y-6"
            >
              <div className="relative">
                <div className="absolute inset-0 bg-blue-500/20 blur-3xl rounded-full animate-pulse" />
                <Loader2 className="w-16 h-16 text-blue-500 animate-spin relative z-10" />
              </div>
              <h3 className="text-xl font-medium">Finding your {selectedVybe?.name} match...</h3>
            </motion.div>
          )}

          {/* STEP 3: QUESTIONS */}
          {step === 'QUESTIONS' && (
            <motion.div 
              key="questions"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  <span>Compatibility Check</span>
                  <span>{currentQuestionIndex + 1} of {QUESTIONS.length}</span>
                </div>
                <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-blue-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${((currentQuestionIndex + 1) / QUESTIONS.length) * 100}%` }}
                  />
                </div>
              </div>

              <div className="text-center space-y-10 py-10">
                <h1 className="text-3xl font-bold leading-tight">
                  {QUESTIONS[currentQuestionIndex].text}
                </h1>
                
                <div className="grid grid-cols-1 gap-4">
                  {QUESTIONS[currentQuestionIndex].options.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => handleSubmitAnswer(opt)}
                      disabled={!!userAnswers[QUESTIONS[currentQuestionIndex].id]}
                      className={`w-full py-5 px-6 rounded-2xl border-2 font-bold text-xl transition-all active:scale-[0.98] ${
                        userAnswers[QUESTIONS[currentQuestionIndex].id] === opt
                          ? 'bg-blue-500 border-blue-500 text-white'
                          : 'border-zinc-800 hover:border-blue-500 hover:bg-blue-500/5'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* STEP 4: RESULT */}
          {step === 'RESULT' && (
            <motion.div 
              key="result"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="h-full flex flex-col items-center justify-center text-center p-4"
            >
              <div className={`mb-6 p-6 rounded-full ${matchResult?.success ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                {matchResult?.success ? (
                  <HeartHandshake className="w-24 h-24 text-green-500" />
                ) : (
                  <XCircle className="w-24 h-24 text-red-500" />
                )}
              </div>
              
              <h1 className="text-4xl font-black mb-2">
                {matchResult?.success ? "It's a Match!" : "Not a Match"}
              </h1>
              <p className="text-zinc-400 mb-10">
                You matched on {matchResult?.score} out of {QUESTIONS.length} questions.
              </p>

              <div className="w-full space-y-3">
                {matchResult?.success ? (
                  <>
                    <button 
                      onClick={() => setStep('CHAT')}
                      className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-colors"
                    >
                      <MessageCircle className="w-5 h-5" />
                      Start Chat
                    </button>
                    <button className="w-full py-4 text-zinc-400 hover:text-white font-medium transition-colors">
                      Send Greeting
                    </button>
                  </>
                ) : (
                  <button 
                    onClick={reset}
                    className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl font-bold text-lg transition-colors"
                  >
                    Return to Vybe Pool
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {/* STEP 5: CHAT */}
          {step === 'CHAT' && (
            <motion.div 
              key="chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="h-full flex flex-col"
            >
              <div className="flex-1 overflow-y-auto space-y-4 mb-4">
                {messages.map((msg) => (
                  <div 
                    key={msg.id} 
                    className={`flex ${msg.userId === user?.uid ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[80%] p-3 rounded-2xl ${
                      msg.userId === user?.uid 
                        ? 'bg-blue-600 text-white rounded-br-none' 
                        : 'bg-zinc-800 text-zinc-100 rounded-bl-none'
                    }`}>
                      {msg.text}
                    </div>
                  </div>
                ))}
              </div>
              
              <form onSubmit={handleSendMessage} className="p-4 border-t border-zinc-800 bg-zinc-950">
                <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-2">
                  <input 
                    type="text" 
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Say hello..." 
                    className="flex-1 bg-transparent border-none focus:outline-none text-sm py-2"
                  />
                  <button type="submit" className="p-2 text-blue-500 hover:bg-blue-500/10 rounded-full transition-colors">
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
