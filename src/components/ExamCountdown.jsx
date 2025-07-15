import { useState, useEffect, useCallback, useRef } from "react";
import { BookOpen, Target, Zap, Lightbulb } from "lucide-react";

// Firebase Imports
import { db } from "../lib/firebase";
import { doc, setDoc, getDoc, deleteDoc } from "firebase/firestore";

// LLM API Imports
import { GoogleGenerativeAI } from "@google/generative-ai";
import ConfirmResetModal from "./ConfirmResetModal";

// Components
import FinishedState from "./FinishedState";
import ResetBtn from "./ResetBtn";

//
const API_KEY = import.meta.env.VITE_LLM_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);

// Constants for retry mechanism
const MAX_RETRIES = 5;

export default function ExamCountdown() {
  // State variables to manage the countdown logic and UI
  const [examDays, setExamDays] = useState(""); // Input for number of days until exam
  const [targetDate, setTargetDate] = useState(null); // The calculated end date for the countdown
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 }); // Remaining time
  const [currentMotivation, setCurrentMotivation] = useState(""); // Motivation message from LLM
  const [currentStudyTip, setCurrentStudyTip] = useState(""); // Study tip from LLM
  const [isLoadingMessage, setIsLoadingMessage] = useState(false); // Controls loading spinner/text for LLM content
  const [appState, setAppState] = useState("initial"); // Tracks the current state of the application: "initial", "active", "finished"
  const [inputError, setInputError] = useState(""); // Error message for input validation
  const [countdownTitle, setCountdownTitle] = useState("Exam Countdown"); // Dynamic title for the countdown display
  const [showResetModal, setShowResetModal] = useState(false); // Controls visibility of the reset confirmation modal

  // Refs to manage component behavior without triggering re-renders
  const lastGeneratedDayRef = useRef(null); // Stores the day for which LLM content was last generated to prevent redundant calls
  const isGeneratingRef = useRef(false); // Flag to prevent multiple simultaneous LLM API calls
  const INITIAL_BACKOFF_DELAY_MS = 1000; // Initial delay for exponential backoff in LLM retries

  // --- LLM Integration Logic ---
  /**
   * Generates personalized motivation and study tips using the Google Generative AI model.
   * Includes retry logic with exponential backoff for API rate limits (429 errors).
   */
  const generateLlmContent = useCallback(
    async (daysRemaining, isExamToday = false) => {
      // Prevent LLM calls if the app is not in the "active" state.
      // This is crucial to stop new content generation once the exam is finished
      // or before a countdown has been set.
      if (appState !== "active") {
        return;
      }

      // Prevent multiple simultaneous LLM API calls to avoid race conditions and
      // unnecessary requests. If a generation is already in progress, return.
      if (isGeneratingRef.current) {
        return;
      }

      // Optimization: If the day hasn't changed and it's not specifically exam day,
      // there's no need to generate new content.
      if (lastGeneratedDayRef.current === daysRemaining && !isExamToday) {
        return;
      }

      // Set the flag to indicate that an LLM generation is now in progress.
      isGeneratingRef.current = true;

      try {
        const model = genAI.getGenerativeModel({ model: import.meta.env.VITE_LLM_MODEL });

        let motivationPrompt = "";
        let studyTipPrompt = "";

        // Determine the appropriate prompt based on the days remaining.
        // The order is important: most specific conditions first.
        if (isExamToday) { // Exam is today (daysRemaining is 0, but there's still time left)
          // Directly set the congratulatory messages and return, as these are static for exam day.
          // No need to call the LLM for these specific messages.
          setCurrentMotivation("🎉 Congratulations! Your exam day has arrived. You've prepared well - now go show what you know!");
          setCurrentStudyTip("Take a deep breath and trust your knowledge. You've got this!");
          setIsLoadingMessage(false); // Turn off loading as content is immediately available
          lastGeneratedDayRef.current = daysRemaining; // Mark this day as processed for LLM content
          isGeneratingRef.current = false; // Reset generation flag
          return; // Exit the function immediately
        } else if (daysRemaining === 1) { // Exam is tomorrow
          motivationPrompt = `Provide a calming, final motivational message (1-2 sentences) for someone whose exam is tomorrow. Emphasize self-care and trust in their preparation.`;
          studyTipPrompt = `Provide a crucial last-minute study tip (1-2 sentences) for someone whose exam is tomorrow, focusing on what NOT to do or a simple quick review method.`;
        } else if (daysRemaining > 50) { // Long-term preparation (more than 50 days)
          motivationPrompt = `Provide a motivating message (1-2 sentences) for someone with ${daysRemaining} days until their exam, focusing on consistent, long-term preparation and avoiding burnout.`;
          studyTipPrompt = `Provide a study tip (1-2 sentences) for someone with ${daysRemaining} days until their exam, focusing on setting clear, achievable milestones and starting early.`;
        } else if (daysRemaining > 30) { // Mid-term preparation (31-50 days)
          motivationPrompt = `Provide a concise, encouraging motivational message (1-2 sentences) for someone with ${daysRemaining} days until a major exam, emphasizing consistent effort and building a solid foundation.`;
          studyTipPrompt = `Provide a practical study tip (1-2 sentences) for someone with ${daysRemaining} days until a major exam, focusing on effective planning, resource utilization, and regular review.`;
        } else if (daysRemaining > 7) { // Short-term focus (8-30 days)
          motivationPrompt = `Provide a concise, focused motivational message (1-2 sentences) for someone with ${daysRemaining} days until their exam, emphasizing perseverance in the mid-stage and tackling weak areas.`;
          studyTipPrompt = `Provide a practical study tip (1-2 sentences) for someone with ${daysRemaining} days until their exam, focusing on active learning, practice questions, and understanding concepts.`;
        } else if (daysRemaining > 0) { // Final stretch (2-7 days)
          motivationPrompt = `Provide a short, intense motivational message (1-2 sentences) for someone in the final stretch, with ${daysRemaining} days until their exam. Boost their confidence for the last push.`;
          studyTipPrompt = `Provide a practical study tip (1-2 sentences) for someone with ${daysRemaining} days until their exam, focusing on effective review strategies, mock exams, and managing stress.`;
        } else { // Fallback for 0 days (if not `isExamToday` or handled otherwise, e.g., initial state)
          motivationPrompt = `Enter days to start your exam countdown and get personalized motivation!`;
          studyTipPrompt = `Enter days to start your exam countdown and get personalized study tips!`;
        }

        // Construct the full prompt for the LLM to request JSON output.
        const fullPrompt = `Based on the following two requests, provide a JSON object with 'motivation' and 'studyTip' keys. Ensure the output is valid JSON, like: {"motivation": "Your motivational message.", "studyTip": "Your study tip."}
        
        Motivation request: "${motivationPrompt}"
        Study Tip request: "${studyTipPrompt}"`;

        // Implement retry mechanism with exponential backoff for API calls.
        // This loop attempts the API call multiple times if a rate limit (429) error occurs.
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            const result = await model.generateContent(fullPrompt);
            const response = result.response;
            const text = response.text();

            let parsedContent;
            try {
              // Clean the text by removing markdown code block syntax and trim whitespace,
              // then parse the JSON string into an object.
              const cleanedText = text.replace(/```json\n|\n```/g, "").trim();
              parsedContent = JSON.parse(cleanedText);
              lastGeneratedDayRef.current = daysRemaining; // Update the ref on successful generation
            } catch (jsonError) {
              console.error("Error parsing LLM JSON content:", jsonError);
              setCurrentMotivation("Failed to get personalized content. (Parsing error)");
              setCurrentStudyTip("Failed to get personalized content. Try again.");
              isGeneratingRef.current = false; // Reset generation flag on parsing error
              return; // Exit function on parsing error as it's not a retryable API issue.
            }

            // Update state with the successfully parsed content.
            setCurrentMotivation(parsedContent.motivation || "No motivation found.");
            setCurrentStudyTip(parsedContent.studyTip || "No study tip found.");
            setIsLoadingMessage(false); // Turn off loading state as content is now displayed.
            isGeneratingRef.current = false; // Reset generation flag on success.
            break; // Exit the retry loop on successful API call and content parsing.

          } catch (error) {
            // Check if the error is a "Too Many Requests" (429) and if more retries are available.
            if (error.message && error.message.includes('429 (Too Many Requests)') && attempt < MAX_RETRIES) {
              // Calculate exponential backoff delay: delay increases with each attempt.
              const delay = INITIAL_BACKOFF_DELAY_MS * Math.pow(2, attempt);
              console.warn(`Attempt ${attempt + 1}: Rate limit hit (429). Retrying in ${delay / 1000} seconds...`);
              setIsLoadingMessage(true); // Keep loading message visible during retry.
              // Pause execution for the calculated delay before retrying.
              await new Promise(resolve => setTimeout(resolve, delay));
            } else {
              // If it's not a 429 error, or max retries have been reached,
              // log the error and display a generic failure message.
              console.error("Error generating LLM content:", error);
              setCurrentMotivation("Failed to load motivation. Please try again later.");
              setCurrentStudyTip("Failed to load tips. Please try again later.");
              setIsLoadingMessage(false); // Turn off loading state on final failure.
              isGeneratingRef.current = false; // Reset generation flag on final failure.
              break; // Exit the retry loop as this error won't be retried.
            }
          }
        }
      } catch (error) {
        // Catch any errors that occur outside the retry loop (e.g., model initialization).
        console.error("Overall error during LLM content generation:", error);
        setCurrentMotivation("An unexpected error occurred. Please try again.");
        setCurrentStudyTip("An unexpected error occurred. Please try again.");
        setIsLoadingMessage(false); // Turn off loading state.
        isGeneratingRef.current = false; // Reset generation flag.
      }
    },
    [appState] // `appState` is a dependency because `generateLlmContent` uses its value for early exit.
  );

  /**
   * Calculates the remaining time (days, hours, minutes, seconds) until a target date.
   */
  const calculateTimeLeft = useCallback((target) => {
    const now = new Date().getTime();
    const targetTime = target.getTime();
    const difference = targetTime - now;

    if (difference <= 0) {
      return { days: 0, hours: 0, minutes: 0, seconds: 0 };
    }

    return {
      days: Math.floor(difference / (1000 * 60 * 60 * 24)),
      hours: Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
      minutes: Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60)),
      seconds: Math.floor((difference % (1000 * 60)) / 1000),
    };
  }, []);

  // --- Persistence Logic (Firestore) ---
  /**
   * Saves the user's target exam date timestamp to Firestore.
   */
  const saveTargetDate = async (date) => {
    try {
      await setDoc(doc(db, import.meta.env.VITE_FIREBASE_DB, import.meta.env.VITE_FIREBASE_DB_COLLECTION), {
        timestamp: date.getTime(),
        setAt: new Date().getTime(), // Record when the date was set
      });
    } catch (e) {
      console.log(e); 
    }
  };

  /**
   * Loads the previously saved target exam date from Firestore.
   * Manages the application state based on whether a date is found and if it's in the future.
   */
  const loadTargetDate = useCallback(async () => {
    // If the app is already in the "finished" state, no need to load or re-evaluate.
    // This prevents redundant operations and potential overwrites.
    if (appState === "finished") {
      return;
    }

    try {
      const docRef = doc(db, import.meta.env.VITE_FIREBASE_DB, import.meta.env.VITE_FIREBASE_DB_COLLECTION);
      const docSnap = await getDoc(docRef);

      // Check if a document exists in Firestore
      if (docSnap.exists()) {
        const data = docSnap.data();
        const loadedTimestamp = data.timestamp;
        const loadedDate = new Date(loadedTimestamp);

        // If the loaded date is in the future, set the app to "active" countdown.
        if (loadedDate.getTime() > new Date().getTime()) {
          setTargetDate(loadedDate);
          setAppState("active");

          const remaining = calculateTimeLeft(loadedDate);
          setCountdownTitle(`${remaining.days} days to go! 💪`);

          // Immediately set loading state for LLM content while it's being fetched.
          setIsLoadingMessage(true);
          setCurrentMotivation("Generating personalized motivation...");
          setCurrentStudyTip("Generating personalized study tip...");
          
          // Trigger LLM content generation based on the loaded date.
          generateLlmContent(remaining.days, remaining.days === 0 && (remaining.hours > 0 || remaining.minutes > 0 || remaining.seconds > 0));
        } else {
          // If the loaded date is in the past (countdown has finished),
          // transition to the "finished" state and set congratulatory messages.
          setAppState("finished");
          setCurrentMotivation(
            "🎉 Congratulations! Your exam day has arrived. You've prepared well - now go show what you know!"
          );
          setCurrentStudyTip("Take a deep breath, trust your knowledge and trust in God. You've got this!");
          setIsLoadingMessage(false); 
          
          // Delete the finished countdown data from Firestore after a short delay
          // to ensure the UI has time to update before deletion.
          setTimeout(() => {
            deleteDoc(doc(db, import.meta.env.VITE_FIREBASE_DB, import.meta.env.VITE_FIREBASE_DB_COLLECTION)).catch((e) =>
              console.error("Error deleting finished doc:", e)
            );
          }, 1000); // 1-second delay
        }
      } else {
        // If no saved data exists, set the app to the "initial" state.
        setAppState("initial");
        setCurrentMotivation("Enter days to start your exam countdown and get personalized motivation!");
        setCurrentStudyTip("Enter days to start your exam countdown and get personalized study tips!");
      }
    } catch (e) {
      // Handle any errors during Firestore loading.
      console.error("Error loading document from Firestore: ", e);
      setAppState("initial");
      setCurrentMotivation("Error loading previous countdown. Please try again.");
      setCurrentStudyTip("Error loading previous countdown. Please try again.");
    }
  }, [calculateTimeLeft, appState]); // `appState` is a dependency for the early exit condition.

  // Effect hook to load target date from Firestore when the component mounts
  // or when `loadTargetDate` callback changes (which it only does if its dependencies change).
  useEffect(() => {
    loadTargetDate();
  }, [loadTargetDate]);

  // Effect hook to update the time left every second (countdown timer logic).
  useEffect(() => {
    let timer;
    // Only start the interval if a targetDate is set and the app is in the "active" state.
    if (targetDate && appState === "active") {
      timer = setInterval(() => {
        const newTimeLeft = calculateTimeLeft(targetDate);
        setTimeLeft(newTimeLeft);

        // --- Prioritize finished state transition and return early ---
        // If the countdown reaches zero, immediately clear the interval,
        // set the app state to "finished", set the static congratulatory messages,
        // and crucially, `return` from this interval tick. This prevents any
        // further code in this tick (including LLM generation) from running,
        // thus avoiding the overwrite.
        if (newTimeLeft.days === 0 && newTimeLeft.hours === 0 && newTimeLeft.minutes === 0 && newTimeLeft.seconds === 0) {
          clearInterval(timer); // Stop the timer immediately.
          setAppState("finished"); // Set app state to finished.
          setCurrentMotivation(
            "🎉 Congratulations! Your exam day has arrived. You've prepared well - now go show what you know!"
          );
          setCurrentStudyTip("Take a deep breath, trust your knowledge and trust in God. You've got this!");
          setIsLoadingMessage(false); // Ensure loading state is off for static messages.
          
          // Delete the finished countdown data from Firestore after a short delay
          // to ensure the UI has time to update before deletion.
          setTimeout(() => {
            deleteDoc(doc(db, import.meta.env.VITE_FIREBASE_DB, import.meta.env.VITE_FIREBASE_DB_COLLECTION)).catch((e) =>
              console.error("Error deleting finished doc:", e)
            );
          }, 1000);
          return; // IMPORTANT: Exit this interval tick early.
        }

        // Only update the countdown title if the app is still in the "active" state.
        if (appState === "active") {
            if (newTimeLeft.days > 0) {
                setCountdownTitle(`${newTimeLeft.days} days to go! 💪`);
            } else if (newTimeLeft.hours > 0 || newTimeLeft.minutes > 0 || newTimeLeft.seconds > 0) {
                setCountdownTitle("Less than a day left! ⏰");
            }
        }

        // Determine if LLM content needs to be generated.
        // This logic ensures generation only happens when the app is active
        // and when the 'days' count changes, or if it's the specific "exam day in progress" scenario.
        const isExamDayInProgress = newTimeLeft.days === 0 && (newTimeLeft.hours > 0 || newTimeLeft.minutes > 0 || newTimeLeft.seconds > 0);

        if (appState === "active" && (newTimeLeft.days !== lastGeneratedDayRef.current || isExamDayInProgress)) {
          // Set loading state and generic messages immediately to prevent flicker
          // while the LLM API call is in progress.
          setIsLoadingMessage(true);
          setCurrentMotivation("Generating personalized motivation...");
          setCurrentStudyTip("Generating personalized study tip...");
          // Trigger the LLM content generation.
          generateLlmContent(newTimeLeft.days, isExamDayInProgress);
        }

      }, 1000); // The interval runs every 1 second.
    }

    // Cleanup function: Clear the interval when the component unmounts or
    // when `targetDate` or `appState` changes, preventing memory leaks.
    return () => clearInterval(timer);
  }, [targetDate, calculateTimeLeft, generateLlmContent, appState]); // `appState` is a dependency for the interval's conditions.

  /**
   * Handles the start of a new countdown based on user input.
   * Performs input validation, sets the target date, saves it to Firestore,
   * and initializes the app state and LLM content generation.
   */
  const handleStartCountdown = async () => {
    const days = Number.parseInt(examDays);

    // Input validation: ensure days is a valid positive number within limits.
    if (!examDays || isNaN(days) || days <= 0) {
      setInputError("Please enter a valid number of days (e.g., 75).");
      return;
    }

    if (days > 365) {
      setInputError("Please enter a number less than 365 days to ensure relevance.");
      return;
    }

    setInputError(""); // Clear any previous input errors.

    // Set loading state for LLM content immediately to provide quick user feedback.
    setIsLoadingMessage(true);
    setCurrentMotivation("Generating personalized motivation...");
    setCurrentStudyTip("Generating personalized study tip...");

    // Calculate the target date: current date + specified days, set to 7 AM.
    const target = new Date();
    target.setDate(target.getDate() + days);
    target.setHours(7, 0, 0, 0); // Set the time the exam starts (7 AM) for consistency.

    // Save the new target date to Firestore for persistence.
    await saveTargetDate(target);
    setTargetDate(target); // Update the target date state.
    setAppState("active"); // Transition app to the active countdown state.
    setCountdownTitle(`${days} days to go! 💪`); // Set initial countdown title.

    // Calculate initial time left and update the state.
    const initialTimeLeft = calculateTimeLeft(target);
    setTimeLeft(initialTimeLeft);

    // Update countdown title based on initial time left (e.g., "Less than a day left!").
    setCountdownTitle(initialTimeLeft.days > 0 ? `${initialTimeLeft.days} days to go! 💪` : "Less than a day left! ⏰");

    // Reset `lastGeneratedDayRef` to null to force a new LLM content generation
    // for the newly set countdown.
    lastGeneratedDayRef.current = null;
    // Trigger initial LLM content generation for the new countdown.
    generateLlmContent(initialTimeLeft.days, initialTimeLeft.days === 0 && (initialTimeLeft.hours > 0 || initialTimeLeft.minutes > 0 || initialTimeLeft.seconds > 0));
  };

  /**
   * Confirms and performs the reset operation.
   * Deletes the saved exam date from Firestore and resets all relevant states
   * to bring the application back to its initial input state.
   */
  const confirmReset = async () => {
    try {
      // Attempt to delete the exam date document from Firestore.
      await deleteDoc(doc(db, import.meta.env.VITE_FIREBASE_DB, import.meta.env.VITE_FIREBASE_DB_COLLECTION));
    } catch (e) {
      console.error("Error deleting document from Firestore: ", e);
    }
    
    // Reset all state variables to their initial values.
    setTargetDate(null);
    setExamDays("");
    setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });

    // Set motivation and study tips back to their initial prompt messages.
    setCurrentMotivation("Enter days to start your exam countdown and get personalized motivation!");
    setCurrentStudyTip("Enter days to start your exam countdown and get personalized study tips!");
    setAppState("initial"); // Transition app state back to "initial".
    setInputError(""); // Clear any input errors.
    setCountdownTitle("Exam Countdown"); // Reset countdown title.
    lastGeneratedDayRef.current = null; // Clear the last generated day ref.
    isGeneratingRef.current = false; // Ensure the generation flag is reset.
    setShowResetModal(false); // Close the confirmation modal.
  };

  /**
   * Opens the reset confirmation modal.
   */
  const handleReset = () => {
    setShowResetModal(true);
  };

  /**
   * Handles the "Enter" key press on the input field to start the countdown.
   */
  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      handleStartCountdown();
    }
  };

  // Conditional rendering based on `appState`
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

  // Render the FinishedState component when the countdown is over.
  // It receives the congratulatory messages and the `confirmReset` function.
  if (appState === "finished") {
    return (
      <FinishedState currentMotivation={currentMotivation} currentStudyTip={currentStudyTip} confirmReset={confirmReset} />
    );
  }

  // Main active countdown display.
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
              // Display loading spinner and message when LLM content is being fetched.
              <div className="flex flex-col items-center justify-center py-8">
                <div className="w-8 h-8 border-b-2 border-indigo-400 rounded-full animate-spin"></div>
                <span className="mt-3 text-slate-400">Generating personalized motivation and tips...</span>
              </div>
            ) : (
              
              // Display LLM-generated motivation and study tips.
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

        {/* Reset Button (extracted to a separate component for cleaner JSX) */}
        <ResetBtn handleReset={handleReset} />
      </div>

      {/* Confirmation modal for resetting the countdown.
          It is displayed conditionally based on `showResetModal` state. */}
      {showResetModal && (
        <ConfirmResetModal cancelReset={() => setShowResetModal(false)} confirmReset={confirmReset} />
      )}
    </div>
  );
}