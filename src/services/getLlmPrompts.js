const getLlmPrompts = (daysRemaining, isExamToday) => {
  let motivationPrompt = "";
  let studyTipPrompt = "";

  if (isExamToday) {
    // static data, since it is the exam day.
    return {
      motivationPrompt:
        "🎉 Congratulations! Your exam day has arrived. You've prepared well - now go show what you know!",
      studyTipPrompt: "Take a deep breath and trust your knowledge and Trust in God. You've got this!",
    };
  } else if (daysRemaining === 1) {
    motivationPrompt = `Provide a calming, final motivational message (1-2 sentences) for someone whose exam is tomorrow. Emphasize self-care and trust in their preparation.`;
    studyTipPrompt = `Provide a crucial last-minute study tip (1-2 sentences) for someone whose exam is tomorrow, focusing on what NOT to do or a simple quick review method.`;
  } else if (daysRemaining > 50) {
    motivationPrompt = `Provide a motivating message (1-2 sentences) for someone with ${daysRemaining} days until their exam, focusing on consistent, long-term preparation and avoiding burnout.`;
    studyTipPrompt = `Provide a study tip (1-2 sentences) for someone with ${daysRemaining} days until their exam, focusing on setting clear, achievable milestones and starting early.`;
  } else if (daysRemaining > 30) {
    motivationPrompt = `Provide a concise, encouraging motivational message (1-2 sentences) for someone with ${daysRemaining} days until a major exam, emphasizing consistent effort and building a solid foundation.`;
    studyTipPrompt = `Provide a practical study tip (1-2 sentences) for someone with ${daysRemaining} days until a major exam, focusing on effective planning, resource utilization, and regular review.`;
  } else if (daysRemaining > 7) {
    motivationPrompt = `Provide a concise, focused motivational message (1-2 sentences) for someone with ${daysRemaining} days until their exam, emphasizing perseverance in the mid-stage and tackling weak areas.`;
    studyTipPrompt = `Provide a practical study tip (1-2 sentences) for someone with ${daysRemaining} days until their exam, focusing on active learning, practice questions, and understanding concepts.`;
  } else if (daysRemaining > 0) {
    motivationPrompt = `Provide a short, intense motivational message (1-2 sentences) for someone in the final stretch, with ${daysRemaining} days until their exam. Boost their confidence for the last push.`;
    studyTipPrompt = `Provide a practical study tip (1-2 sentences) for someone with ${daysRemaining} days until their exam, focusing on effective review strategies, mock exams, and managing stress.`;
  } else {
    // Fallback for 0 days if not handled by isExamToday or initial state
    motivationPrompt = `Enter days to start your exam countdown and get personalized motivation!`;
    studyTipPrompt = `Enter days to start your exam countdown and get personalized study tips!`;
  }
  return { motivationPrompt, studyTipPrompt };
};

export default getLlmPrompts