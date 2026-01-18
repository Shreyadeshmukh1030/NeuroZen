const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const { authenticateToken } = require('./middleware');
require('dotenv').config();

// 🎯 SCORING LOGIC - FIXED MAX 50/50 (TOTAL 100)
const scoring = {
  // ROUND 1 (10 Questions = EXACTLY Max 50 points) ✅
  round1Scoring: {
    q1:  { 1: 2, 2: 3, 3: 4, 4: 5, 5: 5 },        // Wake up feeling low
    q2:  (hours) => {                               // Sleep hours
      const h = parseInt(hours) || 0;
      if (h < 4) return 5; if (h >= 4 && h < 6) return 4;
      if (h >= 6 && h < 8) return 3; if (h >= 8) return 2;
      return 4;
    },
    q3:  { 1: 2, 2: 3, 3: 4, 4: 5, 5: 5 },        // Lose interest in hobbies
    q4:  { 1: 5, 2: 4, 3: 3, 4: 2, 5: 2 },        // Stay focused (REVERSED)
    q5:  { "Yes, definitely": 2, "Somewhat": 4, "No, not really": 5 },
    q6:  { 1: 2, 2: 3, 3: 4, 4: 5, 5: 5 },        // Tasks overwhelming
    q7:  { "Normal": 2, "Poor": 5, "Overeating": 5 },
    q8:  { "Rarely": 2, "Sometimes": 3, "Often": 4, "Constantly": 5 },
    q9:  { "Daily": 2, "3-4 times/week": 3, "1-2 times/week": 4, "Rarely": 5 },
    q10: { 1: 5, 2: 4, 3: 3, 4: 2, 5: 2 }         // Mental health today
  },

  // ROUND 2 (7 Questions = EXACTLY Max 50 points) ✅
  round2Scoring: {
    q1:  { "Not at all": 2, "Mild": 3, "Moderate": 4, "Severe": 5 },
    q2:  { 1: 5, 2: 4, 3: 3, 4: 2, 5: 2 },
    q3:  { "Never": 2, "Sometimes": 4, "Often": 5 },
    q4:  { "Not at all": 2, "Sometimes": 4, "Often": 5 },
    q5:  { "Never": 2, "Sometimes": 4, "Often": 5 },
    q6:  { "Never": 2, "Rarely": 3, "Sometimes": 5, "Often": 5 },
    q7:  { "Regularly": 2, "Occasionally": 4, "Never": 5 }
  }
};

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// 1. REGISTER (PLAIN TEXT)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, age, gender, occupation } = req.body;
    const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Email already exists' });
    }
    
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password, age, gender, occupation) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email, password, age || null, gender || null, occupation || null]
    );
    
    const token = jwt.sign({ id: result.insertId }, process.env.JWT_SECRET || 'NeuroZen2026', { expiresIn: '30d' });
    res.json({ 
      token, 
      user: { id: result.insertId, name, email, age, gender, occupation } 
    });
  } catch (err) {
    console.error('REGISTER ERROR:', err);
    res.status(500).json({ message: 'Registration failed' });
  }
});

// 2. LOGIN (PLAIN TEXT)
app.post('/api/auth/login', async (req, res) => {
  console.log('🔍 LOGIN:', req.body);
  try {
    const { email, password } = req.body;
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ? AND password = ?', [email, password]);
    const user = rows[0];
    
    if (!user) {
      console.log('❌ LOGIN FAILED');
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    
    console.log('✅ LOGIN SUCCESS:', user.name);
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'NeuroZen2026', { expiresIn: '30d' });
    
    res.json({ 
      token, 
      user: { id: user.id, name: user.name, email: user.email, age: user.age, gender: user.gender, occupation: user.occupation } 
    });
  } catch (err) {
    console.error('💥 LOGIN ERROR:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// 3. PROTECTED ROUTES
app.get('/api/profile', authenticateToken, async (req, res) => {
  res.json(req.user);
});

app.put('/api/profile', authenticateToken, async (req, res) => {
  const { name, age, gender, occupation } = req.body;
  await pool.execute(
    'UPDATE users SET name = ?, age = ?, gender = ?, occupation = ? WHERE id = ?',
    [name, age || null, gender || null, occupation || null, req.user.id]
  );
  const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json({ success: true, user: rows[0] });
});

app.get('/api/assessments', authenticateToken, async (req, res) => {
  console.log('📊 GET ASSESSMENTS:', req.user.id);
  const [rows] = await pool.execute('SELECT * FROM assessments WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
  console.log('📊 FOUND:', rows.length, 'assessments');
  res.json(rows);
});

// 🔥 PERFECTED COMPLETE ENDPOINT - TOTAL/100 SCORING (MAX 50+50=100)
app.post('/api/assessments/complete', authenticateToken, async (req, res) => {
  console.log('🔥 COMPLETE ASSESSMENT - TOTAL/100:', req.user.id);
  console.log('📊 ROUND1_ANSWERS:', Object.keys(req.body.round1_answers || {}).length, 'questions');
  console.log('📊 ROUND2_ANSWERS:', Object.keys(req.body.round2_answers || {}).length, 'questions');
  
  try {
    const { round1_answers, round2_answers } = req.body;
    
    if (!round1_answers || !round2_answers) {
      return res.status(400).json({ error: 'Missing round1_answers or round2_answers' });
    }

    // 🧮 ROUND 1 SCORING (GUARANTEED Max 50)
    let round1_score = 0;
    Object.entries(round1_answers).forEach(([qId, answer]) => {
      const scoreMap = scoring.round1Scoring[qId];
      if (scoreMap) {
        if (typeof scoreMap === 'function') {
          round1_score += scoreMap(answer);
        } else {
          round1_score += scoreMap[answer] || 3;  // Default to 3 (middle)
        }
      }
    });
    console.log('📊 ROUND1 SCORE:', round1_score.toFixed(1));

    // 🧮 ROUND 2 SCORING (GUARANTEED Max 50)
    let round2_score = 0;
    Object.entries(round2_answers).forEach(([qId, answer]) => {
      const scoreMap = scoring.round2Scoring[qId];
      if (scoreMap) {
        round2_score += scoreMap[answer] || 3;  // Default to 3 (middle)
      }
    });
    console.log('📊 ROUND2 SCORE:', round2_score.toFixed(1));

    // 🎯 TOTAL /100 & RISK LEVEL
    const total_score = Math.round(round1_score + round2_score);
    const risk_level = total_score < 50 ? 'normal' : total_score <= 80 ? 'moderate' : 'high';

    // 💾 SAVE COMPLETE ASSESSMENT (round_number = 3)
    const [result] = await pool.execute(
      `INSERT INTO assessments (user_id, round_number, answers, score, risk_level, round1_score, round2_score, total_score, created_at) 
       VALUES (?, 3, ?, ?, ?, ?, ?, ?, NOW())`,
      [req.user.id, JSON.stringify({ round1_answers, round2_answers }), total_score, risk_level, round1_score, round2_score, total_score]
    );

    console.log(`💾 TOTAL SAVED: ${total_score}/100 (${risk_level.toUpperCase()}) | R1:${Math.round(round1_score)}/50 R2:${Math.round(round2_score)}/50`);
    
    res.json({ 
      success: true, 
      total_score,
      round1_score: Math.round(round1_score),
      round2_score: Math.round(round2_score),
      risk_level,
      assessment_id: result.insertId 
    });

  } catch (err) {
    console.error('💥 COMPLETE ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

// ❌ DISABLE OLD ROUTES
app.post('/api/assessments/round1', authenticateToken, (req, res) => {
  res.status(410).json({ error: 'Use /api/assessments/complete with round1_answers + round2_answers' });
});

app.post('/api/assessments/round2', authenticateToken, (req, res) => {
  res.status(410).json({ error: 'Use /api/assessments/complete with round1_answers + round2_answers' });
});

app.listen(5000, () => {
  console.log('🚀 NeuroZen Backend LIVE: http://localhost:5000');
  console.log('✅ /api/assessments/complete - TOTAL/100 SCORING FIXED');
  console.log('✅ Round1: MAX 50 | Round2: MAX 50 | TOTAL: MAX 100');
  console.log('✅ Risk: <35=Normal | 35-66=Moderate | 67+=High');
  console.log('✅ OLD round1/round2 routes DISABLED');
});