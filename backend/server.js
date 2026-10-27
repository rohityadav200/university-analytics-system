
require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  })
);

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "university_success_platform",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true,
  dateStrings: true,
});

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

const sendError = (res, status, message) =>
  res.status(status).json({ success: false, message });

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function requiredText(value, maxLength = 255) {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length > 0 && result.length <= maxLength ? result : null;
}

function optionalText(value, maxLength = 255) {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, maxLength);
}

function validDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

function isEmail(value) {
  return (
    typeof value === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) &&
    value.length <= 254
  );
}

function makeTemporaryPassword() {
  // Human-readable temporary credential; user must change it after first sign-in.
  return `Uni@${crypto.randomBytes(5).toString("hex")}7!`;
}

function getMailTransport() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: { user, pass },
  });
}

function validEnum(value, allowed) {
  return allowed.includes(value);
}

function numberInRange(value, min, max) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

async function rows(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

async function first(sql, params = []) {
  const result = await rows(sql, params);
  return result[0] || null;
}

function listResponse(res, data) {
  return res.json({
    success: true,
    count: data.length,
    data,
  });
}

function handleDbError(error, res, message = "Database operation failed") {
  if (error.code === "ER_DUP_ENTRY") {
    return sendError(res, 409, "This record already exists.");
  }

  if (
    error.code === "ER_NO_REFERENCED_ROW_2" ||
    error.code === "ER_ROW_IS_REFERENCED_2"
  ) {
    return sendError(
      res,
      409,
      "This operation conflicts with a related database record."
    );
  }

  console.error(message, error);
  return sendError(
    res,
    500,
    process.env.NODE_ENV === "development"
      ? `${message}: ${error.message}`
      : message
  );
}

// ------------------------------------------------------
// ROOT, HEALTH AND DATABASE TEST
// ------------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "University Success Platform API",
    health: "/api/health",
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Backend is running",
    timestamp: new Date().toISOString(),
  });
});

app.get(
  "/api/db-test",
  asyncHandler(async (req, res) => {
    const result = await first("SELECT DATABASE() AS database_name");
    res.json({
      success: true,
      message: "MySQL connection successful",
      database: result.database_name,
    });
  })
);

// ------------------------------------------------------
// AUTHENTICATION: one-time admin setup and login
// ------------------------------------------------------
const JWT_SECRET = process.env.JWT_SECRET || "local-development-secret-change-before-deployment";

app.get("/api/auth/setup-status", asyncHandler(async (req, res) => {
  const result = await first("SELECT COUNT(*) AS total FROM app_users");
  res.json({ success: true, setupRequired: Number(result.total) === 0 });
}));

app.post("/api/auth/setup", asyncHandler(async (req, res) => {
  const email = requiredText(req.body?.email, 254)?.toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const name = requiredText(req.body?.name, 150);
  if (!name || !email || !isEmail(email) || password.length < 8) {
    return sendError(res, 400, "Enter your name, a valid email, and a password of at least 8 characters.");
  }
  const existing = await first("SELECT COUNT(*) AS total FROM app_users");
  if (Number(existing.total) > 0) return sendError(res, 409, "Admin setup has already been completed. Please log in.");
  const hash = await bcrypt.hash(password, 12);
  const result = await pool.execute(
    "INSERT INTO app_users (name, email, password_hash, role, institution_id) VALUES (?, ?, ?, 'admin', 1)",
    [name, email, hash]
  );
  const user = { user_id: result[0].insertId, name, email, role: "admin", student_id: null, faculty_id: null };
  const token = jwt.sign(user, JWT_SECRET, { expiresIn: "12h" });
  res.status(201).json({ success: true, data: { token, user } });
}));

app.post("/api/auth/student-register", asyncHandler(async (req, res) => {
  const registrationNumber = requiredText(req.body?.registration_number, 60);
  const email = requiredText(req.body?.email, 254)?.toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!registrationNumber || !email || !isEmail(email) || password.length < 8) {
    return sendError(res, 400, "Enter your university registration number, valid email, and a password of at least 8 characters.");
  }
  const student = await first(
    `SELECT student_id, institution_id, first_name, last_name, email
     FROM students WHERE registration_number = ? AND LOWER(email) = ? LIMIT 1`,
    [registrationNumber, email]
  );
  if (!student) return sendError(res, 404, "No matching student record found. Check your registration number and university-recorded email, or contact the administrator.");
  const existing = await first("SELECT user_id FROM app_users WHERE email = ? OR student_id = ? LIMIT 1", [email, student.student_id]);
  if (existing) return sendError(res, 409, "An account already exists for this email or student record. Please sign in or contact the administrator.");
  const name = `${student.first_name} ${student.last_name}`.trim();
  const hash = await bcrypt.hash(password, 12);
  await pool.execute(
    "INSERT INTO app_users (name, email, password_hash, role, student_id, institution_id) VALUES (?, ?, ?, 'student', ?, ?)",
    [name, email, hash, student.student_id, student.institution_id]
  );
  res.status(201).json({ success: true, message: "Student account created. You can now sign in." });
}));

app.post("/api/auth/login", asyncHandler(async (req, res) => {
  const email = requiredText(req.body?.email, 254)?.toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !password) return sendError(res, 400, "Enter your email and password.");
  const user = await first(
    `SELECT user_id, name, email, password_hash, role, student_id, faculty_id, institution_id
     FROM app_users WHERE email = ? AND is_active = 1`, [email]
  );
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return sendError(res, 401, "Incorrect email or password.");
  }
  const requestedRole = req.body?.role;
  if (requestedRole && !["student", "teacher", "admin"].includes(requestedRole)) {
    return sendError(res, 400, "Choose a valid portal role.");
  }
  if (requestedRole && requestedRole !== user.role) {
    return sendError(res, 403, `This account is registered as ${user.role}. Select ${user.role} to sign in.`);
  }
  // Prevent a student account from silently opening another student's portal.
  // If the linked record's name clearly differs from the account name, require an
  // administrator to correct the link before issuing a student session.
  if (user.role === "student") {
    if (!user.student_id) {
      return sendError(res, 409, "This student account is not linked to a student record. Ask the administrator to link it.");
    }
    const linkedStudent = await first(
      "SELECT first_name, last_name, email FROM students WHERE student_id = ? AND institution_id = ?",
      [user.student_id, user.institution_id]
    );
    if (!linkedStudent) {
      return sendError(res, 409, "The linked student record was not found. Ask the administrator to correct the account link.");
    }
    const accountName = String(user.name || "").trim().replace(/\\s+/g, " ").toLowerCase();
    const recordName = `${linkedStudent.first_name} ${linkedStudent.last_name}`.trim().replace(/\\s+/g, " ").toLowerCase();
    if (accountName && recordName && accountName !== recordName) {
      return sendError(res, 409, `This account is linked to ${recordName}, not ${accountName}. Ask the administrator to link the correct student record.`);
    }
  }
  const publicUser = { user_id: user.user_id, name: user.name, email: user.email, role: user.role,
    student_id: user.student_id, faculty_id: user.faculty_id, institution_id: user.institution_id };
  const token = jwt.sign(publicUser, JWT_SECRET, { expiresIn: "12h" });
  res.json({ success: true, data: { token, user: publicUser } });
}));

// Protect every API below this point. Health, DB test and login/setup remain public.
app.use("/api", (req, res, next) => {
  if (["/health", "/db-test", "/auth/setup-status", "/auth/setup", "/auth/login", "/auth/student-register"].includes(req.path)) return next();
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return sendError(res, 401, "Please log in to continue.");
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    return sendError(res, 401, "Your session has expired. Please log in again.");
  }
  const { role } = req.user;
  const path = req.path;
  const method = req.method;
  if (role === "admin" || path === "/auth/me") return next();
  if (role === "student") {
    if ((method === "GET" && ["/student-portal", "/job-opportunities"].includes(path)) ||
        (method === "POST" && ["/student-complaints", "/placement-applications"].includes(path)) ||
        (method === "PATCH" && path === "/auth/change-password")) return next();
    return sendError(res, 403, "Students can only access their own portal and submit their own complaints.");
  }
  if (role === "teacher") {
    const allowed =
      (method === "GET" && ["/dashboard", "/students", "/departments", "/courses", "/subjects", "/academic-performance", "/attendance", "/attendance/summary", "/complaints", "/job-opportunities", "/placements"].includes(path)) ||
      (method === "POST" && ["/academic-performance", "/attendance"].includes(path));
    if (allowed) return next();
    return sendError(res, 403, "This action is not available to the Teacher role.");
  }
  return sendError(res, 403, "This account role is not allowed to access this resource.");
});

app.get("/api/auth/me", (req, res) => {
  const { user_id, name, email, role, student_id, faculty_id, institution_id } = req.user;
  res.json({ success: true, data: { user_id, name, email, role, student_id, faculty_id, institution_id } });
});

app.get("/api/users", asyncHandler(async (req, res) => {
  const data = await rows(`SELECT u.user_id, u.name, u.email, u.role, u.student_id, u.faculty_id, u.is_active, u.created_at,
      CONCAT(s.first_name, ' ', s.last_name) AS student_name,
      CONCAT(f.first_name, ' ', f.last_name) AS faculty_name
    FROM app_users u LEFT JOIN students s ON s.student_id = u.student_id
    LEFT JOIN faculty f ON f.faculty_id = u.faculty_id ORDER BY u.created_at DESC`);
  listResponse(res, data);
}));

app.post("/api/users", asyncHandler(async (req, res) => {
  const name = requiredText(req.body?.name, 150);
  const email = requiredText(req.body?.email, 254)?.toLowerCase();
  const suppliedPassword = typeof req.body?.password === "string" ? req.body.password : "";
  const role = req.body?.role;
  const studentId = req.body?.student_id ? positiveId(req.body.student_id) : null;
  const suppliedFacultyId = req.body?.faculty_id ? positiveId(req.body.faculty_id) : null;
  const departmentId = req.body?.department_id ? positiveId(req.body.department_id) : null;
  if (!name || !email || !isEmail(email) || !["teacher", "student"].includes(role)) {
    return sendError(res, 400, "Provide a name, valid email, and Teacher or Student role.");
  }
  if (role === "teacher" && suppliedPassword.length < 8) return sendError(res, 400, "Provide a teacher password of at least 8 characters.");
  if (role === "student" && !studentId) return sendError(res, 400, "Select the student record to link to this account.");
  const mailTransport = role === "student" ? getMailTransport() : null;
  if (role === "student" && !mailTransport) return sendError(res, 503, "Student account email is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM to backend .env, then restart the backend.");
  if (studentId && !(await first("SELECT student_id FROM students WHERE student_id = ? AND institution_id = ?", [studentId, req.user.institution_id || 1]))) return sendError(res, 400, "Student record was not found in this institution.");
  if (role === "teacher" && suppliedFacultyId && !(await first("SELECT faculty_id FROM faculty WHERE faculty_id = ? AND institution_id = ?", [suppliedFacultyId, req.user.institution_id || 1]))) return sendError(res, 400, "Faculty record was not found in this institution.");
  if (role === "teacher" && !suppliedFacultyId && !departmentId) return sendError(res, 400, "Select the teacher's department so a faculty record can be created automatically.");
  if (role === "teacher" && departmentId && !(await first("SELECT department_id FROM departments WHERE department_id = ? AND institution_id = ?", [departmentId, req.user.institution_id || 1]))) return sendError(res, 400, "Department was not found in this institution.");

  let temporaryPassword = null;
  let password = suppliedPassword;
  let registrationDetails = null;
  if (role === "student") {
    registrationDetails = await first(`SELECT s.student_id, s.registration_number, s.email AS student_email,
      s.first_name, s.last_name, s.institution_id, c.name AS course_name, d.name AS department_name
      FROM students s LEFT JOIN courses c ON c.course_id = s.course_id
      LEFT JOIN departments d ON d.department_id = s.department_id
      WHERE s.student_id = ? AND s.institution_id = ? LIMIT 1`, [studentId, req.user.institution_id || 1]);
    if (!registrationDetails) return sendError(res, 400, "Student record was not found in this institution.");
    if (String(registrationDetails.student_email || "").toLowerCase() !== email) {
      return sendError(res, 400, "For student accounts, use the email address already saved in that student's university record.");
    }
    temporaryPassword = makeTemporaryPassword();
    password = temporaryPassword;
  }
  const hash = await bcrypt.hash(password, 12);
  const institutionId = req.user.institution_id || 1;
  const parts = name.trim().split(/\s+/);
  const firstName = parts.shift() || name;
  const lastName = parts.join(" ") || "";
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let facultyId = role === "teacher" ? suppliedFacultyId : null;
    if (role === "teacher" && !facultyId) {
      // Create the faculty record as part of account creation, so the teacher
      // never gets stuck with an unlinked login.
      const [deptRows] = await connection.execute(
        "SELECT department_id FROM departments WHERE department_id = ? AND institution_id = ? LIMIT 1",
        [departmentId, institutionId]
      );
      if (!deptRows.length) {
        await connection.rollback();
        return sendError(res, 400, "Selected department was not found.");
      }
      const employeeNumber = `FAC-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
      const [facultyResult] = await connection.execute(
        "INSERT INTO faculty (institution_id, department_id, employee_number, first_name, last_name, email, status) VALUES (?, ?, ?, ?, ?, ?, 'active')",
        [institutionId, departmentId, employeeNumber, firstName, lastName, email]
      );
      facultyId = facultyResult.insertId;
    }
    const [userResult] = await connection.execute(
      "INSERT INTO app_users (name, email, password_hash, role, student_id, faculty_id, institution_id, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [name, email, hash, role, role === "student" ? studentId : null, role === "teacher" ? facultyId : null, institutionId, role === "student" ? 1 : 0]
    );
    if (role === "student") {
      const from = process.env.SMTP_FROM || process.env.SMTP_USER;
      const loginUrl = process.env.APP_LOGIN_URL || process.env.CLIENT_URL || "http://localhost:5173";
      const studentName = `${registrationDetails.first_name} ${registrationDetails.last_name}`.trim();
      await mailTransport.sendMail({
        from: from ? `UniSuccess University <${from}>` : undefined,
        to: email,
        subject: "Your UniSuccess student account details",
        text: `Hello ${studentName},

Your university has created your UniSuccess account.

Login page: ${loginUrl}
Name: ${studentName}
Registration number: ${registrationDetails.registration_number}
Email: ${email}
Course: ${registrationDetails.course_name || "Not specified"}
Department: ${registrationDetails.department_name || "Not specified"}
Temporary password: ${temporaryPassword}

Please sign in using the Student portal and change your temporary password immediately. Do not share this password.

Regards,
University Administration`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033"><h2 style="color:#3157c8">Welcome to UniSuccess</h2><p>Hello ${studentName.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))},</p><p>Your university has created your student account.</p><p><b>Login page:</b> <a href="${loginUrl}">${loginUrl}</a></p><table cellpadding="7" style="border-collapse:collapse"><tr><td><b>Name</b></td><td>${studentName}</td></tr><tr><td><b>Registration number</b></td><td>${registrationDetails.registration_number}</td></tr><tr><td><b>Email</b></td><td>${email}</td></tr><tr><td><b>Course</b></td><td>${registrationDetails.course_name || "Not specified"}</td></tr><tr><td><b>Department</b></td><td>${registrationDetails.department_name || "Not specified"}</td></tr><tr><td><b>Temporary password</b></td><td><code>${temporaryPassword}</code></td></tr></table><p><b>Security:</b> Sign in using the Student portal and change your temporary password immediately. Do not share this password.</p><p>Regards,<br/>University Administration</p></div>`
      });
    }
    await connection.commit();
    res.status(201).json({ success: true, message: role === "student" ? "Student account created and login details emailed successfully." : "Teacher account created successfully.", data: { user_id: userResult.insertId, name, email, role, student_id: role === "student" ? studentId : null, faculty_id: facultyId, email_sent: role === "student" } });
  } catch (error) {
    await connection.rollback();
    // Log the actual SMTP/DB error locally so setup failures can be diagnosed.
    console.error("Student account/email failure details:", {
      message: error.message,
      code: error.code,
      command: error.command,
      responseCode: error.responseCode,
      response: error.response,
    });
    if (role === "student" && (error.code?.startsWith("EAUTH") || error.code?.startsWith("ESOCKET") || error.code === "ECONNECTION" || error.responseCode || error.command === "AUTH")) {
      return sendError(res, 502, "Could not send the student email. Check SMTP settings and credentials; the account was not created.");
    }
    if (role === "student" && error.code) {
      console.error("Student welcome email/account creation failed:", error.message);
    }
    handleDbError(error, res, "Could not create account or send student email");
  } finally {
    connection.release();
  }
}));

// Admin can change an existing account's role. Protect against locking out the last admin.
app.patch("/api/users/:userId/role", asyncHandler(async (req, res) => {
  const userId = positiveId(req.params.userId);
  const role = req.body?.role;
  if (!userId || !["admin", "teacher", "student"].includes(role)) {
    return sendError(res, 400, "Choose a valid role: Admin, Teacher, or Student.");
  }
  const target = await first("SELECT user_id, role, institution_id FROM app_users WHERE user_id = ?", [userId]);
  if (!target) return sendError(res, 404, "User account was not found.");
  if (Number(req.user.user_id) === Number(userId) && role !== "admin") {
    return sendError(res, 400, "You cannot change your own role. Use another Admin account.");
  }
  if (target.role === "admin" && role !== "admin") {
    const countRow = await first("SELECT COUNT(*) AS total FROM app_users WHERE role = 'admin' AND is_active = 1 AND institution_id = ?", [target.institution_id]);
    if (Number(countRow?.total || 0) <= 1) return sendError(res, 400, "Cannot demote the last active Admin account.");
  }
  if (role === "student" && !target.role === "student") {
    // Role conversion to Student requires an explicit linked student record below.
  }
  const link = await first("SELECT student_id, faculty_id FROM app_users WHERE user_id = ?", [userId]);
  if (role === "student" && !link?.student_id) return sendError(res, 400, "Link a student record before changing this account to Student.");
  if (role === "teacher" && !link?.faculty_id) return sendError(res, 400, "Link a faculty record before changing this account to Teacher.");
  await pool.execute("UPDATE app_users SET role = ? WHERE user_id = ?", [role, userId]);
  const updated = await first("SELECT user_id, name, email, role, student_id, faculty_id, is_active FROM app_users WHERE user_id = ?", [userId]);
  res.json({ success: true, data: updated, message: `Account role changed to ${role}.` });
}));

// Admin can correct a student's account-to-record link without deleting the account.
app.patch("/api/users/:userId/link", asyncHandler(async (req, res) => {
  const userId = positiveId(req.params.userId);
  const studentId = req.body?.student_id === null || req.body?.student_id === ""
    ? null
    : positiveId(req.body?.student_id);
  if (!userId) return sendError(res, 400, "Invalid user ID.");

  const account = await first(
    "SELECT user_id, role, institution_id FROM app_users WHERE user_id = ?",
    [userId]
  );
  if (!account) return sendError(res, 404, "User account was not found.");
  if (account.role !== "student") {
    return sendError(res, 400, "Only student account links can be changed here.");
  }
  if (!studentId) return sendError(res, 400, "Select a student record to link this account.");

  const student = await first(
    "SELECT student_id FROM students WHERE student_id = ? AND institution_id = ?",
    [studentId, account.institution_id]
  );
  if (!student) return sendError(res, 404, "That student record was not found in this institution. Add the student first.");

  try {
    await pool.execute("UPDATE app_users SET student_id = ? WHERE user_id = ?", [studentId, userId]);
    const updated = await first(
      `SELECT u.user_id, u.name, u.email, u.role, u.student_id,
              CONCAT(s.first_name, ' ', s.last_name) AS student_name
       FROM app_users u LEFT JOIN students s ON s.student_id = u.student_id
       WHERE u.user_id = ?`, [userId]
    );
    res.json({ success: true, data: updated, message: "Student account linked successfully." });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return sendError(res, 409, "This student record is already linked to another account.");
    }
    throw error;
  }
}));

app.patch("/api/auth/change-password", asyncHandler(async (req, res) => {
  const currentPassword = typeof req.body?.current_password === "string" ? req.body.current_password : "";
  const newPassword = typeof req.body?.new_password === "string" ? req.body.new_password : "";
  if (newPassword.length < 8 || newPassword.length > 128) return sendError(res, 400, "New password must be between 8 and 128 characters.");
  if (currentPassword === newPassword) return sendError(res, 400, "Choose a new password different from your current password.");
  const account = await first("SELECT user_id, password_hash FROM app_users WHERE user_id = ? AND is_active = 1", [req.user.user_id]);
  if (!account || !(await bcrypt.compare(currentPassword, account.password_hash))) return sendError(res, 400, "Current password is incorrect.");
  const hash = await bcrypt.hash(newPassword, 12);
  await pool.execute("UPDATE app_users SET password_hash = ?, must_change_password = 0 WHERE user_id = ?", [hash, req.user.user_id]);
  res.json({ success: true, message: "Password changed successfully. Please use your new password next time." });
}));

app.get("/api/student-portal", asyncHandler(async (req, res) => {
  if (req.user.role !== "student" || !req.user.student_id) return sendError(res, 403, "This account is not linked to a student record.");
  const id = req.user.student_id;
  const student = await first(`SELECT s.student_id, s.registration_number, s.first_name, s.last_name, s.email, s.admission_date, s.status,
    d.name AS department_name, c.name AS course_name FROM students s
    LEFT JOIN departments d ON d.department_id=s.department_id LEFT JOIN courses c ON c.course_id=s.course_id WHERE s.student_id=?`, [id]);
  if (!student) return sendError(res, 404, "Your student record could not be found.");
  const [academic, attendance, complaints, opportunities, applications] = await Promise.all([
    rows(`SELECT ap.performance_id, ap.exam_type, ap.marks_obtained, ap.exam_date, sub.name AS subject_name, sub.max_marks
      FROM academic_performance ap JOIN subjects sub ON sub.subject_id=ap.subject_id WHERE ap.student_id=? ORDER BY ap.exam_date DESC`, [id]),
    rows(`SELECT a.attendance_id, a.attendance_date, a.status, sub.name AS subject_name FROM attendance a
      JOIN subjects sub ON sub.subject_id=a.subject_id WHERE a.student_id=? ORDER BY a.attendance_date DESC`, [id]),
    rows("SELECT complaint_id, category, subject, status, priority, created_at, resolution_note FROM complaints WHERE student_id=? ORDER BY created_at DESC", [id]),
    rows("SELECT opportunity_id, title, job_type, minimum_cgpa, application_deadline, status FROM job_opportunities WHERE status='open' ORDER BY application_deadline", []),
    rows(`SELECT pa.application_id, pa.opportunity_id, pa.status, pa.applied_at, jo.title AS opportunity_title, co.name AS company_name
      FROM placement_applications pa JOIN job_opportunities jo ON jo.opportunity_id=pa.opportunity_id
      JOIN companies co ON co.company_id=jo.company_id WHERE pa.student_id=? ORDER BY pa.applied_at DESC`, [id])
  ]);
  res.json({ success: true, data: { student, academic, attendance, complaints, opportunities, applications } });
}));

app.post("/api/student-complaints", asyncHandler(async (req, res) => {
  if (req.user.role !== "student" || !req.user.student_id) return sendError(res, 403, "This account is not linked to a student record.");
  const category = req.body?.category;
  const subject = requiredText(req.body?.subject, 200);
  const description = requiredText(req.body?.description, 5000);
  const priority = req.body?.priority || "medium";
  if (!subject || !description || !validEnum(category, ["academic", "administration", "hostel", "fees", "library", "infrastructure", "other"]) || !validEnum(priority, ["low", "medium", "high"])) {
    return sendError(res, 400, "Enter a valid category, subject, description, and priority.");
  }
  const [result] = await pool.execute("INSERT INTO complaints (institution_id, student_id, category, subject, description, status, priority) VALUES (?, ?, ?, ?, ?, 'submitted', ?)",
    [req.user.institution_id || 1, req.user.student_id, category, subject, description, priority]);
  res.status(201).json({ success: true, data: { complaint_id: result.insertId, status: "submitted" } });
}));

// ------------------------------------------------------
// INSTITUTIONS
// ------------------------------------------------------

app.get(
  "/api/institutions",
  asyncHandler(async (req, res) => {
    const data = await rows(
      `SELECT institution_id, name, code, email, phone, address, status,
              created_at
       FROM institutions
       ORDER BY name`
    );
    listResponse(res, data);
  })
);

// ------------------------------------------------------
// DEPARTMENTS
// ------------------------------------------------------

app.get(
  "/api/departments",
  asyncHandler(async (req, res) => {
    const institutionId = req.query.institution_id
      ? positiveId(req.query.institution_id)
      : null;

    if (req.query.institution_id && !institutionId) {
      return sendError(res, 400, "Invalid institution_id.");
    }

    let sql = `
      SELECT d.department_id, d.institution_id, d.name, d.code,
             i.name AS institution_name
      FROM departments d
      INNER JOIN institutions i ON i.institution_id = d.institution_id
    `;
    const params = [];

    if (institutionId) {
      sql += " WHERE d.institution_id = ?";
      params.push(institutionId);
    }

    sql += " ORDER BY d.name";
    listResponse(res, await rows(sql, params));
  })
);

// ------------------------------------------------------
// COURSES
// ------------------------------------------------------

app.get(
  "/api/courses",
  asyncHandler(async (req, res) => {
    const departmentId = req.query.department_id
      ? positiveId(req.query.department_id)
      : null;

    if (req.query.department_id && !departmentId) {
      return sendError(res, 400, "Invalid department_id.");
    }

    let sql = `
      SELECT c.course_id, c.department_id, c.name, c.code,
             c.duration_years, c.status,
             d.name AS department_name
      FROM courses c
      INNER JOIN departments d ON d.department_id = c.department_id
    `;
    const params = [];

    if (departmentId) {
      sql += " WHERE c.department_id = ?";
      params.push(departmentId);
    }

    sql += " ORDER BY c.name";
    listResponse(res, await rows(sql, params));
  })
);

// ------------------------------------------------------
// SEMESTERS
// ------------------------------------------------------

app.get(
  "/api/semesters",
  asyncHandler(async (req, res) => {
    const courseId = req.query.course_id
      ? positiveId(req.query.course_id)
      : null;

    if (req.query.course_id && !courseId) {
      return sendError(res, 400, "Invalid course_id.");
    }

    let sql = `
      SELECT s.semester_id, s.course_id, s.semester_number,
             s.academic_year, s.start_date, s.end_date,
             c.name AS course_name
      FROM semesters s
      INNER JOIN courses c ON c.course_id = s.course_id
    `;
    const params = [];

    if (courseId) {
      sql += " WHERE s.course_id = ?";
      params.push(courseId);
    }

    sql += " ORDER BY s.course_id, s.semester_number";
    listResponse(res, await rows(sql, params));
  })
);

// ------------------------------------------------------
// SUBJECTS
// Fix for GET /api/subjects?course_id=1
// ------------------------------------------------------

app.get(
  "/api/subjects",
  asyncHandler(async (req, res) => {
    const courseId = req.query.course_id
      ? positiveId(req.query.course_id)
      : null;
    const semesterId = req.query.semester_id
      ? positiveId(req.query.semester_id)
      : null;

    if (req.query.course_id && !courseId) {
      return sendError(res, 400, "Invalid course_id.");
    }

    if (req.query.semester_id && !semesterId) {
      return sendError(res, 400, "Invalid semester_id.");
    }

    let sql = `
      SELECT sub.subject_id, sub.subject_code, sub.name,
             sub.course_id, sub.semester_id,
             sub.max_marks, sub.pass_marks,
             c.name AS course_name,
             sem.semester_number, sem.academic_year
      FROM subjects AS sub
      INNER JOIN courses AS c ON c.course_id = sub.course_id
      INNER JOIN semesters AS sem ON sem.semester_id = sub.semester_id
      WHERE 1 = 1
    `;
    const params = [];

    if (courseId) {
      sql += " AND sub.course_id = ?";
      params.push(courseId);
    }

    if (semesterId) {
      sql += " AND sub.semester_id = ?";
      params.push(semesterId);
    }

    sql += " ORDER BY sem.semester_number, sub.subject_code";

    listResponse(res, await rows(sql, params));
  })
);

// ------------------------------------------------------
// STUDENTS: LIST AND SEARCH
// ------------------------------------------------------

app.get(
  "/api/students",
  asyncHandler(async (req, res) => {
    const departmentId = req.query.department_id
      ? positiveId(req.query.department_id)
      : null;
    const courseId = req.query.course_id
      ? positiveId(req.query.course_id)
      : null;
    const status = req.query.status
      ? requiredText(req.query.status, 30)
      : null;
    const search = req.query.search
      ? requiredText(req.query.search, 100)
      : null;

    if (req.query.department_id && !departmentId) {
      return sendError(res, 400, "Invalid department_id.");
    }
    if (req.query.course_id && !courseId) {
      return sendError(res, 400, "Invalid course_id.");
    }
    if (req.query.status && !status) {
      return sendError(res, 400, "Invalid status.");
    }
    if (status && !validEnum(status, [
      "active", "graduated", "suspended", "withdrawn"
    ])) {
      return sendError(res, 400, "Invalid student status.");
    }
    if (req.query.search && !search) {
      return sendError(res, 400, "Invalid search text.");
    }

    let sql = `
      SELECT s.student_id, s.institution_id, s.department_id,
             s.course_id, s.registration_number, s.first_name,
             s.last_name, s.email, s.admission_date, s.status,
             s.created_at, i.name AS institution_name,
             d.name AS department_name, c.name AS course_name
      FROM students s
      INNER JOIN institutions i ON i.institution_id = s.institution_id
      INNER JOIN departments d ON d.department_id = s.department_id
      INNER JOIN courses c ON c.course_id = s.course_id
      WHERE 1 = 1
    `;
    const params = [];

    if (departmentId) {
      sql += " AND s.department_id = ?";
      params.push(departmentId);
    }
    if (courseId) {
      sql += " AND s.course_id = ?";
      params.push(courseId);
    }
    if (status) {
      sql += " AND s.status = ?";
      params.push(status);
    }
    if (search) {
      sql += ` AND (
        s.first_name LIKE ? OR s.last_name LIKE ? OR
        s.registration_number LIKE ? OR s.email LIKE ?
      )`;
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    sql += " ORDER BY s.student_id DESC";
    listResponse(res, await rows(sql, params));
  })
);

// ------------------------------------------------------
// STUDENTS: CREATE
// ------------------------------------------------------

app.post(
  "/api/students",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const institutionId = positiveId(body.institution_id || 1);
    const departmentName = requiredText(body.department_name, 100);
    const courseName = requiredText(body.course_name, 100);
    const registrationNumber = requiredText(body.registration_number, 60);
    const firstName = requiredText(body.first_name, 100);
    const lastName = requiredText(body.last_name, 100);
    const email = requiredText(body.email, 254);
    const admissionDate = body.admission_date;
    const status = body.status || "active";

    if (
      !institutionId || !departmentName || !courseName ||
      !registrationNumber || !firstName || !lastName ||
      !email || !isEmail(email) || !validDate(admissionDate)
    ) {
      return sendError(
        res,
        400,
        "Provide valid department and course names, registration number, first name, last name, email and admission date."
      );
    }

    if (!validEnum(status, ["active", "graduated", "suspended", "withdrawn"])) {
      return sendError(res, 400, "Invalid student status.");
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [institutionRows] = await connection.execute(
        "SELECT institution_id FROM institutions WHERE institution_id = ? LIMIT 1",
        [institutionId]
      );
      if (!institutionRows.length) {
        await connection.rollback();
        return sendError(res, 400, "Institution not found.");
      }

      // Reuse a department with the same name; otherwise create it automatically.
      let [departmentRows] = await connection.execute(
        "SELECT department_id FROM departments WHERE institution_id = ? AND LOWER(name) = LOWER(?) LIMIT 1",
        [institutionId, departmentName]
      );
      let departmentId;
      if (departmentRows.length) {
        departmentId = departmentRows[0].department_id;
      } else {
        const generatedCode = `MAN${Date.now().toString(36).toUpperCase()}`.slice(0, 30);
        const [departmentResult] = await connection.execute(
          "INSERT INTO departments (institution_id, name, code) VALUES (?, ?, ?)",
          [institutionId, departmentName, generatedCode]
        );
        departmentId = departmentResult.insertId;
      }

      // Reuse a course with the same name in this department; otherwise create it.
      let [courseRows] = await connection.execute(
        "SELECT course_id FROM courses WHERE department_id = ? AND LOWER(name) = LOWER(?) LIMIT 1",
        [departmentId, courseName]
      );
      let courseId;
      if (courseRows.length) {
        courseId = courseRows[0].course_id;
      } else {
        const generatedCode = `MAN${Date.now().toString(36).toUpperCase()}`.slice(0, 30);
        const [courseResult] = await connection.execute(
          "INSERT INTO courses (department_id, name, code, duration_years, status) VALUES (?, ?, ?, 1, 'active')",
          [departmentId, courseName, generatedCode]
        );
        courseId = courseResult.insertId;
      }

      const [result] = await connection.execute(
        `INSERT INTO students
         (institution_id, department_id, course_id, registration_number,
          first_name, last_name, email, admission_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [institutionId, departmentId, courseId, registrationNumber,
         firstName, lastName, email, admissionDate, status]
      );

      const [studentRows] = await connection.execute(
        `SELECT s.*, d.name AS department_name, c.name AS course_name
         FROM students s
         INNER JOIN departments d ON d.department_id = s.department_id
         INNER JOIN courses c ON c.course_id = s.course_id
         WHERE s.student_id = ?`,
        [result.insertId]
      );
      await connection.commit();
      res.status(201).json({
        success: true,
        message: "Student created successfully.",
        data: studentRows[0],
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  })
);

// ------------------------------------------------------
// STUDENTS: UPDATE
// ------------------------------------------------------

app.put(
  "/api/students/:id",
  asyncHandler(async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return sendError(res, 400, "Invalid student ID.");

    const current = await first(
      "SELECT * FROM students WHERE student_id = ?",
      [id]
    );
    if (!current) return sendError(res, 404, "Student not found.");

    const body = req.body || {};
    const institutionId =
      body.institution_id === undefined
        ? current.institution_id
        : positiveId(body.institution_id);
    const departmentId =
      body.department_id === undefined
        ? current.department_id
        : positiveId(body.department_id);
    const courseId =
      body.course_id === undefined
        ? current.course_id
        : positiveId(body.course_id);
    const registrationNumber =
      body.registration_number === undefined
        ? current.registration_number
        : requiredText(body.registration_number, 60);
    const firstName =
      body.first_name === undefined
        ? current.first_name
        : requiredText(body.first_name, 100);
    const lastName =
      body.last_name === undefined
        ? current.last_name
        : requiredText(body.last_name, 100);
    const email =
      body.email === undefined
        ? current.email
        : requiredText(body.email, 254);
    const admissionDate =
      body.admission_date === undefined
        ? current.admission_date
        : body.admission_date;
    const status = body.status === undefined ? current.status : body.status;

    if (
      !institutionId ||
      !departmentId ||
      !courseId ||
      !registrationNumber ||
      !firstName ||
      !lastName ||
      !email ||
      !isEmail(email) ||
      !validDate(admissionDate)
    ) {
      return sendError(res, 400, "Invalid student information.");
    }

    if (!validEnum(status, [
      "active", "graduated", "suspended", "withdrawn"
    ])) {
      return sendError(res, 400, "Invalid student status.");
    }

    await pool.execute(
      `UPDATE students
       SET institution_id = ?, department_id = ?, course_id = ?,
           registration_number = ?, first_name = ?, last_name = ?,
           email = ?, admission_date = ?, status = ?
       WHERE student_id = ?`,
      [
        institutionId, departmentId, courseId, registrationNumber,
        firstName, lastName, email, admissionDate, status, id,
      ]
    );

    res.json({ success: true, message: "Student updated successfully." });
  })
);

// ------------------------------------------------------
// STUDENTS: UPDATE STATUS
// ------------------------------------------------------

app.patch(
  "/api/students/:id/status",
  asyncHandler(async (req, res) => {
    const id = positiveId(req.params.id);
    const status = req.body?.status;

    if (!id) return sendError(res, 400, "Invalid student ID.");
    if (!validEnum(status, [
      "active", "graduated", "suspended", "withdrawn"
    ])) {
      return sendError(res, 400, "Invalid student status.");
    }

    const [result] = await pool.execute(
      "UPDATE students SET status = ? WHERE student_id = ?",
      [status, id]
    );

    if (!result.affectedRows) {
      return sendError(res, 404, "Student not found.");
    }

    res.json({ success: true, message: "Student status updated." });
  })
);

// ------------------------------------------------------
// ACADEMIC PERFORMANCE: LIST
// ------------------------------------------------------

app.get(
  "/api/academic-performance",
  asyncHandler(async (req, res) => {
    const studentId = req.query.student_id
      ? positiveId(req.query.student_id)
      : null;
    const subjectId = req.query.subject_id
      ? positiveId(req.query.subject_id)
      : null;

    if (req.query.student_id && !studentId) {
      return sendError(res, 400, "Invalid student_id.");
    }
    if (req.query.subject_id && !subjectId) {
      return sendError(res, 400, "Invalid subject_id.");
    }

    let sql = `
      SELECT ap.performance_id, ap.student_id, ap.subject_id,
             ap.exam_type, ap.marks_obtained, ap.exam_date,
             s.registration_number, s.first_name, s.last_name,
             sub.subject_code, sub.name AS subject_name,
             sub.max_marks, sub.pass_marks
      FROM academic_performance ap
      INNER JOIN students s ON s.student_id = ap.student_id
      INNER JOIN subjects sub ON sub.subject_id = ap.subject_id
      WHERE 1 = 1
    `;
    const params = [];

    if (studentId) {
      sql += " AND ap.student_id = ?";
      params.push(studentId);
    }
    if (subjectId) {
      sql += " AND ap.subject_id = ?";
      params.push(subjectId);
    }

    sql += " ORDER BY ap.exam_date DESC, ap.performance_id DESC";
    listResponse(res, await rows(sql, params));
  })
);

// ------------------------------------------------------
// ACADEMIC PERFORMANCE: CREATE
// ------------------------------------------------------

app.post(
  "/api/academic-performance",
  asyncHandler(async (req, res) => {
    const studentId = positiveId(req.body?.student_id);
    const subjectName = requiredText(req.body?.subject_name, 150);
    const examType = req.body?.exam_type;
    const marks = numberInRange(req.body?.marks_obtained, 0, 100000);
    const examDate = req.body?.exam_date;

    if (!studentId || !subjectName || marks === null || !validDate(examDate)) {
      return sendError(
        res,
        400,
        "Provide a valid student, subject name, marks and exam date."
      );
    }

    if (!validEnum(examType, ["internal", "midterm", "endterm", "practical"])) {
      return sendError(res, 400, "Invalid exam_type.");
    }

    // Subject is typed directly in the form. Reuse it if it already exists
    // for this student's course; otherwise create it behind the scenes.
    const student = await first(
      "SELECT student_id, course_id FROM students WHERE student_id = ?",
      [studentId]
    );
    if (!student) return sendError(res, 404, "Student not found.");

    const connection = await pool.getConnection();
    let subjectId;
    try {
      await connection.beginTransaction();

      let subject = null;
      const [existingSubjects] = await connection.execute(
        `SELECT subject_id, max_marks
         FROM subjects
         WHERE course_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))
         ORDER BY subject_id LIMIT 1 FOR UPDATE`,
        [student.course_id, subjectName]
      );
      subject = existingSubjects[0] || null;

      if (!subject) {
        const year = Number(examDate.slice(0, 4));
        const month = Number(examDate.slice(5, 7));
        const academicStart = month >= 7 ? year : year - 1;
        const academicYear = `${academicStart}-${academicStart + 1}`;

        const [semesterRows] = await connection.execute(
          `SELECT semester_id FROM semesters
           WHERE course_id = ? AND academic_year = ?
           ORDER BY semester_number LIMIT 1`,
          [student.course_id, academicYear]
        );
        let semesterId = semesterRows[0]?.semester_id;

        if (!semesterId) {
          // If this course has no semester configured for the exam year,
          // create a basic semester record so manual entry still works.
          const [sameYearRows] = await connection.execute(
            `SELECT semester_id FROM semesters
             WHERE course_id = ? ORDER BY semester_number LIMIT 1`,
            [student.course_id]
          );
          semesterId = sameYearRows[0]?.semester_id;
          if (!semesterId) {
            const [semesterInsert] = await connection.execute(
              `INSERT INTO semesters (course_id, semester_number, academic_year)
               VALUES (?, 1, ?)`,
              [student.course_id, academicYear]
            );
            semesterId = semesterInsert.insertId;
          }
        }

        const baseCode = subjectName
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "")
          .slice(0, 18) || "SUBJECT";
        let subjectCode = baseCode;
        let suffix = 1;
        while (true) {
          const [codeRows] = await connection.execute(
            "SELECT subject_id FROM subjects WHERE course_id = ? AND subject_code = ? LIMIT 1",
            [student.course_id, subjectCode]
          );
          if (!codeRows.length) break;
          subjectCode = `${baseCode.slice(0, 14)}${suffix++}`;
        }

        const [subjectInsert] = await connection.execute(
          `INSERT INTO subjects
           (course_id, semester_id, subject_code, name, max_marks, pass_marks)
           VALUES (?, ?, ?, ?, 100, 40)`,
          [student.course_id, semesterId, subjectCode, subjectName]
        );
        subjectId = subjectInsert.insertId;
        subject = { subject_id: subjectId, max_marks: 100 };
      } else {
        subjectId = subject.subject_id;
      }

      if (marks > Number(subject.max_marks)) {
        await connection.rollback();
        return sendError(
          res,
          400,
          `Marks cannot exceed the subject maximum of ${subject.max_marks}.`
        );
      }

      const [result] = await connection.execute(
        `INSERT INTO academic_performance
         (student_id, subject_id, exam_type, marks_obtained, exam_date)
         VALUES (?, ?, ?, ?, ?)`,
        [studentId, subjectId, examType, marks, examDate]
      );

      await connection.commit();
      res.status(201).json({
        success: true,
        message: "Academic performance recorded. Subject created or reused automatically.",
        performance_id: result.insertId,
        subject_id: subjectId,
      });
    } catch (error) {
      await connection.rollback();
      if (error?.code === "ER_DUP_ENTRY") {
        return sendError(
          res,
          409,
          "Marks for this student, subject and exam type already exist. Choose another exam type or update the existing record."
        );
      }
      throw error;
    } finally {
      connection.release();
    }
  })
);

// ------------------------------------------------------
// ATTENDANCE: LIST
// ------------------------------------------------------

app.get(
  "/api/attendance",
  asyncHandler(async (req, res) => {
    const studentId = req.query.student_id
      ? positiveId(req.query.student_id)
      : null;
    const subjectId = req.query.subject_id
      ? positiveId(req.query.subject_id)
      : null;

    if (req.query.student_id && !studentId) {
      return sendError(res, 400, "Invalid student_id.");
    }
    if (req.query.subject_id && !subjectId) {
      return sendError(res, 400, "Invalid subject_id.");
    }

    let sql = `
      SELECT a.attendance_id, a.student_id, a.subject_id,
             a.attendance_date, a.status, a.recorded_by,
             s.registration_number, s.first_name, s.last_name,
             sub.subject_code, sub.name AS subject_name
      FROM attendance a
      INNER JOIN students s ON s.student_id = a.student_id
      INNER JOIN subjects sub ON sub.subject_id = a.subject_id
      WHERE 1 = 1
    `;
    const params = [];

    if (studentId) {
      sql += " AND a.student_id = ?";
      params.push(studentId);
    }
    if (subjectId) {
      sql += " AND a.subject_id = ?";
      params.push(subjectId);
    }

    sql += " ORDER BY a.attendance_date DESC, a.attendance_id DESC";
    listResponse(res, await rows(sql, params));
  })
);

// ------------------------------------------------------
// ATTENDANCE: CREATE
// ------------------------------------------------------

app.post(
  "/api/attendance",
  asyncHandler(async (req, res) => {
    const studentId = positiveId(req.body?.student_id);
    const attendanceDate = req.body?.attendance_date;
    const status = req.body?.status;
    const subjectName = requiredText(req.body?.subject_name, 150);
    const suppliedSubjectId = req.body?.subject_id ? positiveId(req.body.subject_id) : null;
    const recordedBy = req.body?.recorded_by ? positiveId(req.body.recorded_by) : null;

    if (!studentId || !validDate(attendanceDate) ||
        !validEnum(status, ["present", "absent", "late", "excused"]) ||
        (!subjectName && !suppliedSubjectId) || (req.body?.recorded_by && !recordedBy)) {
      return sendError(res, 400, "Provide a student, subject name, valid date and attendance status.");
    }

    const student = await first("SELECT student_id, course_id FROM students WHERE student_id = ?", [studentId]);
    if (!student) return sendError(res, 404, "Student not found.");

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      let subjectId = suppliedSubjectId;
      if (subjectName) {
        const [matches] = await connection.execute(
          `SELECT subject_id FROM subjects
           WHERE course_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))
           ORDER BY subject_id LIMIT 1`, [student.course_id, subjectName]);
        if (matches.length) {
          subjectId = matches[0].subject_id;
        } else {
          const year = Number(attendanceDate.slice(0, 4));
          const month = Number(attendanceDate.slice(5, 7));
          const academicStart = month >= 7 ? year : year - 1;
          const academicYear = `${academicStart}-${academicStart + 1}`;
          const [semesterRows] = await connection.execute(
            `SELECT semester_id FROM semesters WHERE course_id = ? AND academic_year = ?
             ORDER BY semester_number LIMIT 1`, [student.course_id, academicYear]);
          let semesterId = semesterRows[0]?.semester_id;
          if (!semesterId) {
            const [existingSemesters] = await connection.execute(
              `SELECT semester_id FROM semesters WHERE course_id = ? ORDER BY semester_number LIMIT 1`, [student.course_id]);
            semesterId = existingSemesters[0]?.semester_id;
          }
          if (!semesterId) {
            const [semesterInsert] = await connection.execute(
              `INSERT INTO semesters (course_id, semester_number, academic_year) VALUES (?, 1, ?)`,
              [student.course_id, academicYear]);
            semesterId = semesterInsert.insertId;
          }
          const baseCode = subjectName.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 18) || "SUBJECT";
          let subjectCode = baseCode;
          let suffix = 1;
          while (true) {
            const [codeRows] = await connection.execute(
              "SELECT subject_id FROM subjects WHERE course_id = ? AND subject_code = ? LIMIT 1", [student.course_id, subjectCode]);
            if (!codeRows.length) break;
            subjectCode = `${baseCode.slice(0, 14)}${suffix++}`;
          }
          const [subjectInsert] = await connection.execute(
            `INSERT INTO subjects (course_id, semester_id, subject_code, name, max_marks, pass_marks)
             VALUES (?, ?, ?, ?, 100, 40)`, [student.course_id, semesterId, subjectCode, subjectName]);
          subjectId = subjectInsert.insertId;
        }
      }
      const [result] = await connection.execute(
        `INSERT INTO attendance (student_id, subject_id, attendance_date, status, recorded_by)
         VALUES (?, ?, ?, ?, ?)`, [studentId, subjectId, attendanceDate, status, recordedBy]);
      await connection.commit();
      res.status(201).json({ success: true, message: "Attendance recorded successfully.", attendance_id: result.insertId, subject_id: subjectId });
    } catch (error) {
      await connection.rollback();
      if (error?.code === "ER_DUP_ENTRY") return sendError(res, 409, "Attendance for this student, subject and date already exists.");
      throw error;
    } finally {
      connection.release();
    }
  })
);

// ------------------------------------------------------
// ATTENDANCE SUMMARY
// ------------------------------------------------------

app.get(
  "/api/attendance/summary",
  asyncHandler(async (req, res) => {
    const data = await rows(`
      SELECT s.student_id, s.registration_number,
             CONCAT(s.first_name, ' ', s.last_name) AS student_name,
             sub.subject_id, sub.subject_code,
             sub.name AS subject_name,
             COUNT(a.attendance_id) AS total_classes,
             SUM(a.status IN ('present', 'late')) AS attended_classes,
             ROUND(
               100.0 * SUM(a.status IN ('present', 'late')) /
               NULLIF(COUNT(a.attendance_id), 0), 2
             ) AS attendance_percentage
      FROM attendance a
      INNER JOIN students s ON s.student_id = a.student_id
      INNER JOIN subjects sub ON sub.subject_id = a.subject_id
      GROUP BY s.student_id, s.registration_number, s.first_name,
               s.last_name, sub.subject_id, sub.subject_code, sub.name
      ORDER BY attendance_percentage ASC
    `);

    listResponse(res, data);
  })
);

// ------------------------------------------------------
// COMPLAINTS: LIST
// ------------------------------------------------------

app.get(
  "/api/complaints",
  asyncHandler(async (req, res) => {
    const status = req.query.status
      ? requiredText(req.query.status, 30)
      : null;
    const studentId = req.query.student_id
      ? positiveId(req.query.student_id)
      : null;

    if (req.query.status && !status) {
      return sendError(res, 400, "Invalid status.");
    }
    if (req.query.student_id && !studentId) {
      return sendError(res, 400, "Invalid student_id.");
    }

    let sql = `
      SELECT c.complaint_id, c.institution_id, c.student_id,
             c.category, c.subject, c.description, c.status,
             c.priority, c.resolution_note, c.created_at, c.updated_at,
             CONCAT(s.first_name, ' ', s.last_name) AS student_name,
             s.registration_number
      FROM complaints c
      LEFT JOIN students s ON s.student_id = c.student_id
      WHERE 1 = 1
    `;
    const params = [];

    if (status) {
      if (!validEnum(status, [
        "submitted", "under_review", "resolved", "rejected"
      ])) {
        return sendError(res, 400, "Invalid complaint status.");
      }
      sql += " AND c.status = ?";
      params.push(status);
    }

    if (studentId) {
      sql += " AND c.student_id = ?";
      params.push(studentId);
    }

    sql += " ORDER BY c.created_at DESC";
    listResponse(res, await rows(sql, params));
  })
);

// ------------------------------------------------------
// COMPLAINTS: CREATE
// ------------------------------------------------------

app.post(
  "/api/complaints",
  asyncHandler(async (req, res) => {
    const institutionId = positiveId(req.body?.institution_id || 1);
    const studentId = req.body?.student_id
      ? positiveId(req.body.student_id)
      : null;
    const category = req.body?.category;
    const subject = requiredText(req.body?.subject, 200);
    const description = requiredText(req.body?.description, 5000);
    const priority = req.body?.priority || "medium";

    if (
      !institutionId ||
      (req.body?.student_id && !studentId) ||
      !subject ||
      !description
    ) {
      return sendError(res, 400, "Invalid complaint information.");
    }

    if (!validEnum(category, [
      "academic", "administration", "hostel", "fees",
      "library", "infrastructure", "other"
    ])) {
      return sendError(res, 400, "Invalid complaint category.");
    }

    if (!validEnum(priority, ["low", "medium", "high"])) {
      return sendError(res, 400, "Invalid complaint priority.");
    }

    const [result] = await pool.execute(
      `INSERT INTO complaints
       (institution_id, student_id, category, subject,
        description, status, priority)
       VALUES (?, ?, ?, ?, ?, 'submitted', ?)`,
      [institutionId, studentId, category, subject, description, priority]
    );

    res.status(201).json({
      success: true,
      message: "Complaint submitted successfully.",
      complaint_id: result.insertId,
    });
  })
);

// ------------------------------------------------------
// COMPLAINTS: UPDATE STATUS
// ------------------------------------------------------

app.patch(
  "/api/complaints/:id/status",
  asyncHandler(async (req, res) => {
    const id = positiveId(req.params.id);
    const status = req.body?.status;
    const resolutionNote = optionalText(req.body?.resolution_note, 5000);

    if (!id) return sendError(res, 400, "Invalid complaint ID.");

    if (!validEnum(status, [
      "submitted", "under_review", "resolved", "rejected"
    ])) {
      return sendError(res, 400, "Invalid complaint status.");
    }

    const [result] = await pool.execute(
      `UPDATE complaints
       SET status = ?, resolution_note = ?
       WHERE complaint_id = ?`,
      [status, resolutionNote, id]
    );

    if (!result.affectedRows) {
      return sendError(res, 404, "Complaint not found.");
    }

    res.json({
      success: true,
      message: "Complaint status updated successfully.",
    });
  })
);

// ------------------------------------------------------
// COMPANIES
// ------------------------------------------------------

app.get("/api/companies", asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return sendError(res, 403, "Only administrators can view company management.");
  const data = await rows("SELECT company_id, institution_id, name, industry, website, created_at FROM companies WHERE institution_id = ? ORDER BY name", [req.user.institution_id || 1]);
  listResponse(res, data);
}));

// ------------------------------------------------------
// JOB OPPORTUNITIES
// ------------------------------------------------------

app.get(
  "/api/job-opportunities",
  asyncHandler(async (req, res) => {
    const data = await rows(`
      SELECT jo.opportunity_id, jo.company_id, jo.title,
             jo.job_type, jo.minimum_cgpa, jo.application_deadline,
             jo.status, jo.created_at, c.name AS company_name,
             c.industry, c.website
      FROM job_opportunities jo
      INNER JOIN companies c ON c.company_id = jo.company_id
      ORDER BY jo.created_at DESC
    `);
    listResponse(res, data);
  })
);

// ------------------------------------------------------
// PLACEMENT MANAGEMENT: ADMIN WRITE ROUTES
// ------------------------------------------------------

app.post("/api/companies", asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return sendError(res, 403, "Only administrators can add companies.");
  const name = requiredText(req.body.name, 200);
  const industry = optionalText(req.body.industry, 100);
  const website = optionalText(req.body.website, 255);
  const institutionId = positiveId(req.user.institution_id) || 1;
  if (!name) return sendError(res, 400, "Company name is required (maximum 200 characters).");
  const [result] = await pool.execute(
    "INSERT INTO companies (institution_id, name, industry, website) VALUES (?, ?, ?, ?)",
    [institutionId, name, industry, website]
  );
  res.status(201).json({ success: true, message: "Company added successfully.", data: { company_id: result.insertId, name, industry, website } });
}));

app.post("/api/job-opportunities", asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return sendError(res, 403, "Only administrators can publish job opportunities.");
  const companyId = positiveId(req.body.company_id);
  const title = requiredText(req.body.title, 150);
  const jobType = req.body.job_type || "full_time";
  const minimumCgpa = req.body.minimum_cgpa === "" || req.body.minimum_cgpa == null ? null : numberInRange(req.body.minimum_cgpa, 0, 10);
  const deadline = req.body.application_deadline || null;
  const status = req.body.status || "open";
  if (!companyId || !title) return sendError(res, 400, "Select a company and enter a job title.");
  if (!validEnum(jobType, ["internship", "full_time", "part_time"])) return sendError(res, 400, "Invalid job type.");
  if (req.body.minimum_cgpa !== "" && req.body.minimum_cgpa != null && minimumCgpa === null) return sendError(res, 400, "Minimum CGPA must be between 0 and 10.");
  if (deadline && !validDate(deadline)) return sendError(res, 400, "Application deadline must be a valid date.");
  if (!validEnum(status, ["open", "closed", "cancelled"])) return sendError(res, 400, "Invalid opportunity status.");
  const company = await first("SELECT company_id FROM companies WHERE company_id = ? AND institution_id = ?", [companyId, req.user.institution_id || 1]);
  if (!company) return sendError(res, 400, "Company was not found in your institution.");
  const [result] = await pool.execute(
    "INSERT INTO job_opportunities (company_id, title, job_type, minimum_cgpa, application_deadline, status) VALUES (?, ?, ?, ?, ?, ?)",
    [companyId, title, jobType, minimumCgpa, deadline, status]
  );
  res.status(201).json({ success: true, message: "Job opportunity published.", data: { opportunity_id: result.insertId } });
}));

app.patch("/api/job-opportunities/:id/status", asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return sendError(res, 403, "Only administrators can update job status.");
  const id = positiveId(req.params.id);
  const status = req.body.status;
  if (!id || !validEnum(status, ["open", "closed", "cancelled"])) return sendError(res, 400, "Valid opportunity ID and status are required.");
  const [result] = await pool.execute(
    "UPDATE job_opportunities jo JOIN companies c ON c.company_id = jo.company_id SET jo.status = ? WHERE jo.opportunity_id = ? AND c.institution_id = ?",
    [status, id, req.user.institution_id || 1]
  );
  if (!result.affectedRows) return sendError(res, 404, "Job opportunity not found.");
  res.json({ success: true, message: "Opportunity status updated." });
}));

app.post("/api/placement-applications", asyncHandler(async (req, res) => {
  if (req.user.role !== "student" || !positiveId(req.user.student_id)) return sendError(res, 403, "A linked student account is required to apply.");
  const opportunityId = positiveId(req.body.opportunity_id);
  if (!opportunityId) return sendError(res, 400, "A valid job opportunity is required.");
  const student = await first("SELECT student_id, institution_id, status FROM students WHERE student_id = ? AND institution_id = ?", [req.user.student_id, req.user.institution_id || 1]);
  if (!student || student.status !== "active") return sendError(res, 403, "Only active students can apply.");
  const opportunity = await first(`SELECT jo.opportunity_id, jo.application_deadline FROM job_opportunities jo JOIN companies c ON c.company_id=jo.company_id WHERE jo.opportunity_id=? AND jo.status='open' AND c.institution_id=?`, [opportunityId, req.user.institution_id || 1]);
  if (!opportunity) return sendError(res, 404, "This opportunity is not open or was not found.");
  if (opportunity.application_deadline && opportunity.application_deadline < new Date().toISOString().slice(0, 10)) return sendError(res, 400, "The application deadline has passed.");
  const existing = await first("SELECT application_id FROM placement_applications WHERE opportunity_id = ? AND student_id = ?", [opportunityId, req.user.student_id]);
  if (existing) return sendError(res, 409, "You have already applied for this opportunity.");
  const [result] = await pool.execute("INSERT INTO placement_applications (opportunity_id, student_id, status) VALUES (?, ?, 'applied')", [opportunityId, req.user.student_id]);
  res.status(201).json({ success: true, message: "Application submitted successfully.", data: { application_id: result.insertId } });
}));

app.patch("/api/placement-applications/:id/status", asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return sendError(res, 403, "Only administrators can update application status.");
  const id = positiveId(req.params.id);
  const status = req.body.status;
  if (!id || !validEnum(status, ["applied", "shortlisted", "interview", "offered", "rejected", "accepted"])) return sendError(res, 400, "Valid application ID and status are required.");
  const [result] = await pool.execute(`UPDATE placement_applications pa JOIN students s ON s.student_id=pa.student_id SET pa.status=? WHERE pa.application_id=? AND s.institution_id=?`, [status, id, req.user.institution_id || 1]);
  if (!result.affectedRows) return sendError(res, 404, "Application not found.");
  res.json({ success: true, message: "Application status updated." });
}));

app.post("/api/placements", asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return sendError(res, 403, "Only administrators can record placements.");
  const applicationId = positiveId(req.body.application_id);
  const packageAmount = req.body.package_amount === "" || req.body.package_amount == null ? null : numberInRange(req.body.package_amount, 0, 1000000000);
  const placementDate = req.body.placement_date || null;
  if (!applicationId) return sendError(res, 400, "Select an application to record the placement.");
  if (req.body.package_amount !== "" && req.body.package_amount != null && packageAmount === null) return sendError(res, 400, "Package amount must be a non-negative number.");
  if (placementDate && !validDate(placementDate)) return sendError(res, 400, "Placement date must be a valid date.");
  const application = await first(`SELECT pa.application_id FROM placement_applications pa JOIN students s ON s.student_id=pa.student_id JOIN job_opportunities jo ON jo.opportunity_id=pa.opportunity_id JOIN companies c ON c.company_id=jo.company_id WHERE pa.application_id=? AND pa.status IN ('offered','accepted') AND s.institution_id=? AND c.institution_id=?`, [applicationId, req.user.institution_id || 1, req.user.institution_id || 1]);
  if (!application) return sendError(res, 400, "Only an offered or accepted application from your institution can be recorded as a placement.");
  const [result] = await pool.execute("INSERT INTO placements (application_id, package_amount, placement_date) VALUES (?, ?, ?)", [applicationId, packageAmount, placementDate]);
  res.status(201).json({ success: true, message: "Placement recorded successfully.", data: { placement_id: result.insertId } });
}));

// ------------------------------------------------------
// PLACEMENT APPLICATIONS
// ------------------------------------------------------

app.get(
  "/api/placement-applications",
  asyncHandler(async (req, res) => {
    const data = await rows(`
      SELECT pa.application_id, pa.opportunity_id, pa.student_id,
             pa.status, pa.applied_at,
             CONCAT(s.first_name, ' ', s.last_name) AS student_name,
             s.registration_number, jo.title AS job_title,
             c.name AS company_name
      FROM placement_applications pa
      INNER JOIN students s ON s.student_id = pa.student_id
      INNER JOIN job_opportunities jo
        ON jo.opportunity_id = pa.opportunity_id
      INNER JOIN companies c ON c.company_id = jo.company_id
      ORDER BY pa.applied_at DESC
    `);
    listResponse(res, data);
  })
);

// ------------------------------------------------------
// PLACEMENTS
// ------------------------------------------------------

app.get(
  "/api/placements",
  asyncHandler(async (req, res) => {
    const data = await rows(`
      SELECT p.placement_id, p.application_id, p.package_amount,
             p.placement_date, pa.student_id,
             CONCAT(s.first_name, ' ', s.last_name) AS student_name,
             s.registration_number, jo.title AS job_title,
             c.name AS company_name
      FROM placements p
      INNER JOIN placement_applications pa
        ON pa.application_id = p.application_id
      INNER JOIN students s ON s.student_id = pa.student_id
      INNER JOIN job_opportunities jo
        ON jo.opportunity_id = pa.opportunity_id
      INNER JOIN companies c ON c.company_id = jo.company_id
      ORDER BY p.placement_date DESC
    `);
    listResponse(res, data);
  })
);

// ------------------------------------------------------
// DASHBOARD ANALYTICS
// ------------------------------------------------------

app.get(
  "/api/dashboard",
  asyncHandler(async (req, res) => {
    const [
      students,
      activeStudents,
      graduatedStudents,
      attendanceRecordCount,
      averagePackage,
      departments,
      courses,
      faculty,
      complaints,
      pendingComplaints,
      opportunities,
      applications,
      placements,
      performance,
      attendance,
      complaintStatuses,
      departmentStats,
      recentComplaints,
    ] = await Promise.all([
      first("SELECT COUNT(*) AS total FROM students"),
      first("SELECT COUNT(*) AS total FROM students WHERE status = 'active'"),
      first("SELECT COUNT(*) AS total FROM students WHERE status = 'graduated'"),
      first("SELECT COUNT(*) AS total FROM attendance"),
      first("SELECT ROUND(AVG(package_amount), 2) AS average_package FROM placements"),
      first("SELECT COUNT(*) AS total FROM departments"),
      first("SELECT COUNT(*) AS total FROM courses"),
      first("SELECT COUNT(*) AS total FROM faculty"),
      first("SELECT COUNT(*) AS total FROM complaints"),
      first(
        "SELECT COUNT(*) AS total FROM complaints WHERE status IN ('submitted','under_review')"
      ),
      first(
        "SELECT COUNT(*) AS total FROM job_opportunities WHERE status = 'open'"
      ),
      first("SELECT COUNT(*) AS total FROM placement_applications"),
      first("SELECT COUNT(*) AS total FROM placements"),
      first(`
        SELECT ROUND(AVG(ap.marks_obtained / NULLIF(sub.max_marks, 0) * 100), 2)
          AS average_percentage
        FROM academic_performance ap
        INNER JOIN subjects sub ON sub.subject_id = ap.subject_id
      `),
      first(`
        SELECT ROUND(
          100.0 * SUM(status IN ('present', 'late')) /
          NULLIF(COUNT(*), 0), 2
        ) AS attendance_percentage
        FROM attendance
      `),
      rows(`
        SELECT status, COUNT(*) AS total
        FROM complaints
        GROUP BY status
      `),
      rows(`
        SELECT d.department_id, d.name AS department_name,
               COUNT(s.student_id) AS total_students
        FROM departments d
        LEFT JOIN students s ON s.department_id = d.department_id
        GROUP BY d.department_id, d.name
        ORDER BY total_students DESC, d.name
      `),
      rows(`
        SELECT complaint_id, subject, category, status, priority, created_at
        FROM complaints
        ORDER BY created_at DESC
        LIMIT 5
      `),
    ]);

    res.json({
      success: true,
      data: {
        totalStudents: Number(students.total),
        activeStudents: Number(activeStudents.total),
        graduatedStudents: Number(graduatedStudents.total),
        totalAttendanceRecords: Number(attendanceRecordCount.total),
        averagePackage: averagePackage.average_package === null
          ? null
          : Number(averagePackage.average_package),
        totalDepartments: Number(departments.total),
        totalCourses: Number(courses.total),
        totalFaculty: Number(faculty.total),
        totalComplaints: Number(complaints.total),
        pendingComplaints: Number(pendingComplaints.total),
        openOpportunities: Number(opportunities.total),
        totalApplications: Number(applications.total),
        totalPlacements: Number(placements.total),
        averagePercentage: performance.average_percentage === null
          ? 0
          : Number(performance.average_percentage),
        attendancePercentage: attendance.attendance_percentage === null
          ? 0
          : Number(attendance.attendance_percentage),
        complaintStatuses,
        departmentStats,
        recentComplaints,
      },
    });
  })
);

// ------------------------------------------------------
// 404 AND CENTRAL ERROR HANDLER
// ------------------------------------------------------

app.use("/api", (req, res) => {
  sendError(res, 404, `API route not found: ${req.method} ${req.originalUrl}`);
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error.type === "entity.parse.failed") {
    return sendError(res, 400, "Invalid JSON request body.");
  }

  if (error.code === "ER_DUP_ENTRY") {
    return sendError(res, 409, "A record with these details already exists.");
  }

  console.error("Unhandled server error:", error);
  return sendError(
    res,
    500,
    process.env.NODE_ENV === "development"
      ? error.message
      : "Internal server error"
  );
});

// ------------------------------------------------------
// START SERVER
// ------------------------------------------------------

async function startServer() {
  try {
    await pool.query("SELECT 1");
    await pool.query(`CREATE TABLE IF NOT EXISTS app_users (
      user_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      email VARCHAR(254) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('admin','teacher','student') NOT NULL,
      student_id BIGINT UNSIGNED NULL UNIQUE,
      faculty_id BIGINT UNSIGNED NULL UNIQUE,
      institution_id BIGINT UNSIGNED NOT NULL DEFAULT 1,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      must_change_password TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
    const userColumns = await pool.query("SHOW COLUMNS FROM app_users LIKE 'must_change_password'");
    if (!userColumns[0].length) await pool.query("ALTER TABLE app_users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0");
    console.log("MySQL database connected successfully.");

    app.listen(PORT, () => {
      console.log(`University Success Platform API running at http://localhost:${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error("Could not connect to MySQL:", error.message);
    process.exit(1);
  }
}

startServer();

process.on("SIGINT", async () => {
  await pool.end();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});
