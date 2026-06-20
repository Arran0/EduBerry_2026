/**
 * Official CBSE subjects (Secondary & Senior Secondary), used to power the
 * subject smart-search when creating an exam. Teachers can pick one of these or
 * type a custom subject name of their own.
 */
export const CBSE_SUBJECTS: string[] = [
  // Core sciences & mathematics
  'Mathematics',
  'Applied Mathematics',
  'Science',
  'Physics',
  'Chemistry',
  'Biology',
  'Biotechnology',
  'Computer Science',
  'Informatics Practices',
  'Information Technology',
  'Artificial Intelligence',
  'Engineering Graphics',
  'Environmental Science',

  // Commerce
  'Accountancy',
  'Business Studies',
  'Economics',
  'Entrepreneurship',

  // Social sciences & humanities
  'Social Science',
  'History',
  'Geography',
  'Political Science',
  'Sociology',
  'Psychology',
  'Philosophy',
  'Legal Studies',
  'Knowledge Tradition and Practices of India',

  // Languages
  'English',
  'English Core',
  'English Elective',
  'Hindi',
  'Hindi Core',
  'Hindi Elective',
  'Sanskrit',
  'Urdu',
  'Punjabi',
  'Bengali',
  'Tamil',
  'Telugu',
  'Kannada',
  'Malayalam',
  'Marathi',
  'Gujarati',
  'Odia',
  'Assamese',
  'French',
  'German',
  'Spanish',
  'Japanese',
  'Arabic',
  'Persian',

  // Arts, health & skill
  'Physical Education',
  'Health and Physical Education',
  'Yoga',
  'Fine Arts',
  'Painting',
  'Music',
  'Hindustani Music',
  'Carnatic Music',
  'Dance',
  'Home Science',
  'Fashion Studies',
  'Multimedia and Web Technology',
]

/** Case-insensitive prefix/substring match for the subject picker. */
export function searchSubjects(query: string, limit = 8): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const starts: string[] = []
  const contains: string[] = []
  for (const s of CBSE_SUBJECTS) {
    const lower = s.toLowerCase()
    if (lower.startsWith(q)) starts.push(s)
    else if (lower.includes(q)) contains.push(s)
  }
  return [...starts, ...contains].slice(0, limit)
}
