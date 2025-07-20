import { useState, useEffect, useCallback, useRef } from "react";
import { BookOpen, Target, Zap, Lightbulb } from "lucide-react";

// Firebase Imports
import { db, auth, signInAnonymously } from "../lib/firebase";
import { doc, setDoc, getDoc, deleteDoc } from "firebase/firestore";

// LLM API Imports
import { GoogleGenerativeAI } from "@google/generative-ai";

// Components
import ConfirmResetModal from "./ConfirmResetModal";
import FinishedState from "./FinishedState";
import ResetBtn from "./ResetBtn";

// services
import getLlmPrompts from "../services/getLlmPrompts";
import calculateTimeLeft from "../services/calculateTimeLeft";

// --- Configuration Constants ---
const API_KEY = import.meta.env.VITE_LLM_API_KEY;
const LLM_MODEL = import.meta.env.VITE_LLM_MODEL;
const FIREBASE_COLLECTION_NAME = import.meta.env.VITE_FIREBASE_DB_COLLECTION;

// LLM Retry Constants
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_DELAY_MS = 1000; // 1 second

// Initialize Generative AI client once
const genAI = new GoogleGenerativeAI(API_KEY);
const llmModel = genAI.getGenerativeModel({ model: LLM_MODEL });


// --- Main Component ---
export default function ExamCountdown() {
  // State variables
  const [examDays, setExamDays] = useState("");
  const [targetDate, setTargetDate] = useState(null);
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [currentMotivation, setCurrentMotivation] = useState("");
  const [currentStudyTip, setCurrentStudyTip] = useState("");
  const [isLoadingMessage, setIsLoadingMessage] = useState(false);
  const [appState, setAppState] = useState("loading");
  const [inputError, setInputError] = useState("");
  const [countdownTitle, setCountdownTitle] = useState("Exam Countdown");
  const [showResetModal, setShowResetModal] = useState(false);
  const [user, setUser] = useState(null);

  // Refs for managing side effects and avoiding re-renders
  const lastGeneratedDayRef = useRef(null);
  const isGeneratingRef = useRef(false); // Prevents concurrent LLM calls

  // --- Firebase Anonymous Authentication ---
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (currentUser) {
        //if User is signed in.
        setUser(currentUser);

        // proceed to load data
        loadTargetDate(currentUser.uid);
      } else {
        //if no user is signed in, sign user in anonymously.
        try {
          const userCredential = await signInAnonymously(auth);
          setUser(userCredential.user);

          // Load data immediately after signing in
          loadTargetDate(userCredential.user.uid);
        } catch (error) {
          console.error("Error signing in anonymously:", error);

          // Handle error
          setAppState("error");
          setCurrentMotivation("Failed to load. Please check your internet connection.");
          setCurrentStudyTip("Failed to load. Please try refreshing the page.");
        }
      }
    });

    // Cleanup subscription on component unmount
    return () => unsubscribe();
  }, []);

  // --- LLM Integration Logic ---
  const generateLlmContent = useCallback(
    async (daysRemaining, isExamToday = false) => {

      if (appState !== "active" || isGeneratingRef.current) {
        return;
      }

      // If the content is static for exam today, update state and return early
      if (isExamToday) {
        const { motivationPrompt, studyTipPrompt } = getLlmPrompts(daysRemaining, isExamToday);
        setCurrentMotivation(motivationPrompt);
        setCurrentStudyTip(studyTipPrompt);
        setIsLoadingMessage(false);
        lastGeneratedDayRef.current = daysRemaining;
        return;
      }

      // don't generate if the day hasn't changed and it's not exam day
      if (lastGeneratedDayRef.current === daysRemaining && !isExamToday) {
        return;
      }

      isGeneratingRef.current = true;
      setIsLoadingMessage(true);
      setCurrentMotivation("Generating personalized motivation...");
      setCurrentStudyTip("Generating personalized study tip...");

      const { motivationPrompt, studyTipPrompt } = getLlmPrompts(daysRemaining, isExamToday);

      const fullPrompt = `Based on the following two requests, provide a JSON object with 'motivation' and 'studyTip' keys. Ensure the output is valid JSON, like: {"motivation": "Your motivational message.", "studyTip": "Your study tip."}

        Motivation request: "${motivationPrompt}"
        Study Tip request: "${studyTipPrompt}"`;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const result = await llmModel.generateContent(fullPrompt);
          const response = result.response;
          const text = response.text();

          const cleanedText = text.replace(/```json\n|\n```/g, "").trim();
          const parsedContent = JSON.parse(cleanedText);

          setCurrentMotivation(parsedContent.motivation || "No motivation found.");
          setCurrentStudyTip(parsedContent.studyTip || "No study tip found.");
          lastGeneratedDayRef.current = daysRemaining; // Update ref only on success
          setIsLoadingMessage(false);
          break; // Exit loop on success
        } catch (error) {
          if (error.message && error.message.includes("429 (Too Many Requests)") && attempt < MAX_RETRIES) {
            const delay = INITIAL_BACKOFF_DELAY_MS * Math.pow(2, attempt);
            console.warn(`Attempt ${attempt + 1}: Rate limit hit (429). Retrying in ${delay / 1000} seconds...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          } else {
            console.error("Error generating LLM content or parsing JSON:", error);
            setCurrentMotivation("Failed to load motivation. Please try again later.");
            setCurrentStudyTip("Failed to load tips. Please try again later.");
            setIsLoadingMessage(false);
            break; // Exit loop on unretryable error or max retries
          }
        }
      }
      isGeneratingRef.current = false; // Reset after all attempts
    },
    [appState] // re-run when appState Changes
  );

  // --- Persistence Logic (Firestore) ---
  const saveTargetDate = useCallback(async (date, uid) => {
    if (!uid) {
      // if uid is not available, exit;
      return;
    }
    try {
      await setDoc(doc(db, FIREBASE_COLLECTION_NAME, uid), { // Use UID as document ID
        timestamp: date.getTime(),
        setAt: new Date().getTime(),
      });
      // target data saved
    } catch (e) {
      console.error("Error saving target date to Firestore: ", e);
    }
  }, []);


  const deleteTargetDate = useCallback(async (uid) => {
    if (!uid) {
      // if uid is not available, exit;
      return;
    }
    try {
      await deleteDoc(doc(db, FIREBASE_COLLECTION_NAME, uid));
    } catch (e) {
      console.error("Error deleting document from Firestore: ", e);
    }
  }, []);


  const loadTargetDate = useCallback(async (uid) => {
    if (!uid) {
      return;
    }
    if (appState === "finished") {
      return;
    }

    try {
      const docRef = doc(db, FIREBASE_COLLECTION_NAME, uid);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        const loadedTimestamp = data.timestamp;
        const loadedDate = new Date(loadedTimestamp);

        if (loadedDate.getTime() > new Date().getTime()) {
          setTargetDate(loadedDate);
          setAppState("active");

          const remaining = calculateTimeLeft(loadedDate);
          setCountdownTitle(`${remaining.days} days to go! 💪`);
          setTimeLeft(remaining); // Set initial time left from loaded data

          // Trigger LLM content generation for the loaded state
          const isExamDayInProgress = remaining.days === 0 && (remaining.hours > 0 || remaining.minutes > 0 || remaining.seconds > 0);
          generateLlmContent(remaining.days, isExamDayInProgress);
        } else {
          //if date is in the past, transition to finished state
          setAppState("finished"); // display the finished state to the user
          setCurrentMotivation(
            "🎉 Congratulations! Your exam day has arrived. You've prepared well - now go show what you know!"
          );
          setCurrentStudyTip("Take a deep breath, trust your knowledge and trust in God. You've got this!");
          setIsLoadingMessage(false);
          // Delete after a small delay to allow UI to update
          setTimeout(() => deleteTargetDate(uid), 1000); 
        }
      } else {
        // if there is no saved data for this user
        setAppState("initial");
        setCurrentMotivation("Enter days to start your exam countdown and get personalized motivation!");
        setCurrentStudyTip("Enter days to start your exam countdown and get personalized study tips!");
      }
    } catch (e) {
      console.error("Error loading document from Firestore: ", e);
      setAppState("initial");
      setCurrentMotivation("");
      setCurrentStudyTip("");
    }
  }, [appState, generateLlmContent, deleteTargetDate]);

  // Effect hook to update the time left every second (countdown timer logic).
  useEffect(() => {
    let timer;
    if (targetDate && appState === "active") {
      timer = setInterval(() => {
        const newTimeLeft = calculateTimeLeft(targetDate);
        setTimeLeft(newTimeLeft);

        // Check if countdown has finished
        if (newTimeLeft.days === 0 && newTimeLeft.hours === 0 && newTimeLeft.minutes === 0 && newTimeLeft.seconds === 0) {
          clearInterval(timer);
          setAppState("finished");
          setCurrentMotivation("🎉 Congratulations! Your exam day has arrived. You've prepared well - now go show what you know!");
          setCurrentStudyTip("Take a deep breath, trust your knowledge and trust in God. You've got this!");
          setIsLoadingMessage(false);
          if (user?.uid) { // Only attempt to delete if user is available
            setTimeout(() => deleteTargetDate(user.uid), 1000); // Delete after a short delay
          }
          return;
        }

        // Update countdown title
        if (newTimeLeft.days > 0) {
          setCountdownTitle(`${newTimeLeft.days} days to go! 💪`);
        } else {
          setCountdownTitle("Less than a day left! ⏰");
        }

        // Trigger LLM content generation if the day changes or if it's exam day (0 days, but time left)
        const isExamDayInProgress = newTimeLeft.days === 0 && (newTimeLeft.hours > 0 || newTimeLeft.minutes > 0 || newTimeLeft.seconds > 0);
        if (newTimeLeft.days !== lastGeneratedDayRef.current || isExamDayInProgress) {
          generateLlmContent(newTimeLeft.days, isExamDayInProgress);
        }
      }, 1000);
    }

    return () => clearInterval(timer);
  }, [targetDate, generateLlmContent, appState, deleteTargetDate, user]);

  // --- Handlers ---
  const handleStartCountdown = async () => {
    const days = Number.parseInt(examDays);

    if (!examDays || isNaN(days) || days <= 0) {
      setInputError("Please enter a valid number of days (e.g., 75).");
      return;
    }
    if (days > 365) {
      setInputError("Please enter a number less than 365 days to ensure relevance.");
      return;
    }
    if (!user?.uid) { // Ensure user UID is available before attempting to save
      setInputError("Authentication not ready. Please wait a moment and try again.");
      return;
    }

    setInputError("");

    const target = new Date();
    target.setDate(target.getDate() + days);
    target.setHours(7, 0, 0, 0); // Set to 7 AM on the day of exam

    await saveTargetDate(target, user.uid); // Pass UID to save
    setTargetDate(target);
    setAppState("active");

    const initialTimeLeft = calculateTimeLeft(target);
    setTimeLeft(initialTimeLeft);
    setCountdownTitle(initialTimeLeft.days > 0 ? `${initialTimeLeft.days} days to go! 💪` : "Less than a day left! ⏰");

    lastGeneratedDayRef.current = null; // Force new LLM generation
    generateLlmContent(initialTimeLeft.days, initialTimeLeft.days === 0 && (initialTimeLeft.hours > 0 || initialTimeLeft.minutes > 0 || initialTimeLeft.seconds > 0));
  };

  const confirmReset = async () => {
    if (user?.uid) { // Only attempt to delete if user is available
      await deleteTargetDate(user.uid); // Pass UID to delete
    }
    setTargetDate(null);
    setExamDays("");
    setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
    setCurrentMotivation("Enter days to start your exam countdown and get personalized motivation!");
    setCurrentStudyTip("Enter days to start your exam countdown and get personalized study tips!");
    setAppState("initial");
    setInputError("");
    setCountdownTitle("Exam Countdown");
    lastGeneratedDayRef.current = null;
    isGeneratingRef.current = false;
    setShowResetModal(false);
  };

  const handleReset = () => setShowResetModal(true);
  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      handleStartCountdown();
    }
  };

  // --- Conditional Rendering ---
  if (appState === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen p-4 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900">
        <div className="text-center text-white">
          <div className="w-8 h-8 mx-auto mb-4 border-b-2 border-indigo-400 rounded-full animate-spin"></div>
          <p className="text-sm">Loading application...</p>
        </div>
      </div>
    );
  }

  if (appState === "initial") {
    return (
      <div className="flex items-center justify-center min-h-screen p-4 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900">
        <div className="w-full max-w-md">
          <div className="border rounded-lg shadow-sm border-slate-700/50 bg-slate-800/50 backdrop-blur-sm">
            <div className="px-4 py-8 sm:px-10 sm:py-10">
              <div className="mb-8 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 mb-4 rounded-full bg-indigo-600/20">
                  <BookOpen className="w-6 h-6 text-indigo-400 lg:h-10 md:w-10" />
                </div>
                <h1 className="mb-2 font-bold text-[1rem] text-white sm:text-2xl">Exam Countdown</h1>
                <p className="text-[.75rem] sm:text-sm text-slate-400">
                  Set your countdown and get personalized study motivation
                </p>
              </div>

              <div className="space-y-6">
                <div>
                  <label
                    htmlFor="days"
                    className="block mb-2 text-[.75rem] sm:text-sm font-medium text-slate-300"
                  >
                    Days until your exam
                  </label>
                  <input
                    id="days"
                    type="number"
                    placeholder="Enter number of days.."
                    value={examDays}
                    onChange={(e) => {
                      setExamDays(e.target.value);
                      setInputError("");
                    }}
                    onKeyPress={handleKeyPress}
                    className="flex w-full h-10 px-3 py-2 text-[.75rem] sm:text-sm text-white rounded-md outline-none bg-slate-700/50 placeholder:text-slate-400"
                    min="1"
                    max="365"
                  />
                  {inputError && <p className="mt-2 text-[.75rem] text-red-400">{inputError}</p>}
                </div>

                <button
                  onClick={handleStartCountdown}
                  className="w-full h-12 text-[.75rem] sm:text-sm font-medium transform inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm transition-all duration-200 bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg hover:shadow-xl"
                >
                  <Target className="w-4 h-4 mr-2 sm:w-5 sm:h-5" />
                  Start Countdown
                </button>

                <div className="text-center">
                  <p className="text-[.75rem] sm:text-sm text-slate-400">Your countdown will be saved automatically</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="fixed text-center bottom-4">
          <p className="text-slate-500 text-[.8rem]">&copy; TimmyStroge</p>
        </div>
      </div>
    );
  }

  if (appState === "finished") {
    return (
      <FinishedState
        currentMotivation={currentMotivation}
        currentStudyTip={currentStudyTip}
        confirmReset={confirmReset}
      />
    );
  }

  return (
    <div className="min-h-screen p-4 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900">
      <div className="max-w-4xl mx-auto">
        {/* Header Section */}
        <div className="pt-8 mb-8 text-center">
          <h1 className="mb-2 text-2xl font-bold text-white md:text-3xl">Exam Countdown</h1>
          <p className="text-sm text-slate-400">Stay focused and motivated on your journey to success</p>
        </div>

        {/* Countdown Display Grid */}
        <div className="grid grid-cols-2 gap-4 mb-8 md:grid-cols-4">
          {/* Days Card */}
          <div className="border rounded-lg shadow-sm bg-gradient-to-br from-blue-600/20 to-blue-800/20 border-blue-500/30 bg-slate-800/50 backdrop-blur-sm">
            <div className="p-6 text-center">
              <div className="mb-2 text-3xl font-bold text-blue-300 transition-all duration-300 md:text-4xl">
                {timeLeft.days.toString().padStart(2, "0")}
              </div>
              <div className="text-sm font-medium tracking-wide uppercase text-slate-300">Days</div>
            </div>
          </div>

          {/* Hours Card */}
          <div className="border rounded-lg shadow-sm bg-gradient-to-br from-green-600/20 to-green-800/20 border-green-500/30 bg-slate-800/50 backdrop-blur-sm">
            <div className="p-6 text-center">
              <div className="mb-2 text-3xl font-bold text-green-300 transition-all duration-300 md:text-4xl">
                {timeLeft.hours.toString().padStart(2, "0")}
              </div>
              <div className="text-sm font-medium tracking-wide uppercase text-slate-300">Hours</div>
            </div>
          </div>

          {/* Minutes Card */}
          <div className="border rounded-lg shadow-sm bg-gradient-to-br from-yellow-600/20 to-yellow-800/20 border-yellow-500/30 bg-slate-800/50 backdrop-blur-sm">
            <div className="p-6 text-center">
              <div className="mb-2 text-3xl font-bold text-yellow-300 transition-all duration-300 md:text-4xl">
                {timeLeft.minutes.toString().padStart(2, "0")}
              </div>
              <div className="text-sm font-medium tracking-wide uppercase text-slate-300">Minutes</div>
            </div>
          </div>

          {/* Seconds Card */}
          <div className="border rounded-lg shadow-sm bg-gradient-to-br from-red-600/20 to-red-800/20 border-red-500/30 bg-slate-800/50 backdrop-blur-sm">
            <div className="p-6 text-center">
              <div className="mb-2 text-3xl font-bold text-red-300 transition-all duration-300 md:text-4xl">
                {timeLeft.seconds.toString().padStart(2, "0")}
              </div>
              <div className="text-sm font-medium tracking-wide uppercase text-slate-300">Seconds</div>
            </div>
          </div>
        </div>

        {/* Motivation & Study Tip Section */}
        <div className="mb-8 border rounded-lg shadow-sm border-slate-700/50 bg-slate-800/50 backdrop-blur-sm min-h-[180px] flex flex-col justify-center">
          <div className="p-6">
            {isLoadingMessage ? (
              <div className="flex flex-col items-center justify-center py-8">
                <div className="w-8 h-8 border-b-2 border-indigo-400 rounded-full animate-spin"></div>
                <span className="mt-3 text-slate-400">Generating personalized motivation and tips...</span>
              </div>
            ) : (
              <>
                <div className="flex items-start mb-4">
                  <Zap className="flex-shrink-0 w-5 h-5 mt-1 mr-2 text-indigo-400" />
                  <div>
                    <h2 className="mb-1 text-sm font-semibold capitalize text-slate-100">{countdownTitle}</h2>
                    <p className="text-[.8rem] italic leading-relaxed text-slate-300">"{currentMotivation}"</p>
                  </div>
                </div>

                <div className="p-4 mt-6 rounded-md shadow-sm border-slate-700/50 bg-slate-700/20">
                  <div className="flex items-center mb-2">
                    <Lightbulb className="flex-shrink-0 w-4 h-4 mr-1 text-green-600" />
                    <h2 className="text-[.75rem] font-semibold text-green-600 capitalize">Study Tip:</h2>
                  </div>
                  <div className="ml-2">
                    <p className="text-[.75rem] italic leading-relaxed text-slate-300">{currentStudyTip}</p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <ResetBtn handleReset={handleReset} />
      </div>

      {showResetModal && (
        <ConfirmResetModal cancelReset={() => setShowResetModal(false)} confirmReset={confirmReset} />
      )}
    </div>
  );
}