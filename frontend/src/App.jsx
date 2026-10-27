
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, MessageSquareWarning, GraduationCap,
  CalendarCheck, BriefcaseBusiness, RefreshCw, Search,
  Plus, Menu, X, AlertCircle, CheckCircle2, LogOut, ShieldCheck, UserRound, KeyRound
} from "lucide-react";
import axios from "axios";
import "./App.css";

const API = "http://localhost:5000/api";
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem("unisuccesstoken");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const navigation = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "students", label: "Students", icon: Users },
  { id: "complaints", label: "Complaints", icon: MessageSquareWarning },
  { id: "academics", label: "Academic performance", icon: GraduationCap },
  { id: "attendance", label: "Attendance", icon: CalendarCheck },
  { id: "placements", label: "Placements", icon: BriefcaseBusiness },
  { id: "accounts", label: "User accounts", icon: ShieldCheck },
];

function getRows(response) {
  const body = response?.data;
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

function formatNumber(value) {
  return Number(value ?? 0).toLocaleString("en-IN");
}

function App() {
  const [page, setPage] = useState("dashboard");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [students, setStudents] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [academic, setAcademic] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [placements, setPlacements] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [placementApplications, setPlacementApplications] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [courses, setCourses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [studentPortal, setStudentPortal] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  async function loadData() {
    if (!authUser) return;
    setLoading(true);
    setError("");
    try {
      if (authUser.role === "student") {
        const response = await axios.get(`${API}/student-portal`);
        setStudentPortal(response.data.data);
        setLoading(false);
        return;
      }
      const requests = [
        axios.get(`${API}/dashboard`),
        axios.get(`${API}/students`),
        axios.get(`${API}/complaints`),
        axios.get(`${API}/academic-performance`),
        axios.get(`${API}/attendance`),
        axios.get(`${API}/placements`),
        axios.get(`${API}/departments`),
        axios.get(`${API}/courses`),
        axios.get(`${API}/subjects?course_id=1`),
        axios.get(`${API}/job-opportunities`),
        authUser.role === "admin" ? axios.get(`${API}/companies`) : Promise.resolve({ data: { data: [] } }),
        authUser.role === "admin" ? axios.get(`${API}/placement-applications`) : Promise.resolve({ data: { data: [] } }),
      ];
      if (authUser.role === "admin") requests.push(axios.get(`${API}/users`));
      const results = await Promise.allSettled(requests);
      const failed = results.findIndex((r) => r.status === "rejected");
      const value = (index) =>
        results[index].status === "fulfilled"
          ? results[index].value
          : null;

      if (value(0)) setDashboard(value(0).data.data);
      if (value(1)) setStudents(getRows(value(1)));
      if (value(2)) setComplaints(getRows(value(2)));
      if (value(3)) setAcademic(getRows(value(3)));
      if (value(4)) setAttendance(getRows(value(4)));
      if (value(5)) setPlacements(getRows(value(5)));
      if (value(6)) setDepartments(getRows(value(6)));
      if (value(7)) setCourses(getRows(value(7)));
      if (value(8)) setSubjects(getRows(value(8)));
      if (value(9)) setOpportunities(getRows(value(9)));
      if (value(10)) setCompanies(getRows(value(10)));
      if (value(11)) setPlacementApplications(getRows(value(11)));
      if (authUser.role === "admin" && value(12)) setAccounts(getRows(value(12)));

      if (failed !== -1 && !value(0)) {
        setError("Cannot load the dashboard. Check that the backend is running.");
      } else if (failed !== -1) {
        setError("Some data could not be loaded. Check the backend terminal.");
      }
    } catch {
      setError("Cannot connect to the backend at localhost:5000.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;
    async function initializeAuth() {
      try {
        const status = await axios.get(`${API}/auth/setup-status`);
        if (!alive) return;
        setSetupRequired(Boolean(status.data.setupRequired));
        const token = localStorage.getItem("unisuccesstoken");
        if (token) {
          const response = await axios.get(`${API}/auth/me`);
          if (alive) setAuthUser(response.data.data);
        }
      } catch (err) {
        if (err.response?.status === 401) localStorage.removeItem("unisuccesstoken");
        else if (alive) setError("Cannot connect to the backend at localhost:5000.");
      } finally { if (alive) setAuthChecking(false); }
    }
    initializeAuth();
    return () => { alive = false; };
  }, []);

  useEffect(() => { if (authUser) loadData(); }, [authUser]);

  async function submitForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());

    try {
      setError("");
      if (page === "student-home") {
        await axios.post(`${API}/student-complaints`, values);
      } else if (page === "students") {
        await axios.post(`${API}/students`, {
          ...values,
          institution_id: 1,
          department_name: values.department_name?.trim(),
          course_name: values.course_name?.trim(),
        });
      } else if (page === "complaints") {
        await axios.post(`${API}/complaints`, {
          ...values,
          institution_id: 1,
          student_id: Number(values.student_id),
        });
      } else if (page === "academics") {
        await axios.post(`${API}/academic-performance`, {
          ...values,
          student_id: Number(values.student_id),
          subject_name: values.subject_name?.trim(),
          marks_obtained: Number(values.marks_obtained),
        });
      } else if (page === "attendance") {
        await axios.post(`${API}/attendance`, {
          ...values,
          student_id: Number(values.student_id),
          subject_name: values.subject_name?.trim(),
        });
      }
      setNotice("Record saved successfully.");
      setShowForm(false);
      form.reset();
      await loadData();
    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Could not save the record. Check required fields and the backend error."
      );
    }
  }

  async function updateComplaint(id, status) {
    try {
      setError("");
      await axios.patch(`${API}/complaints/${id}/status`, { status });
      setNotice("Complaint status updated.");
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || "Could not update complaint status.");
    }
  }

  async function updateStudentStatus(id, status) {
    try {
      setError("");
      await axios.patch(`${API}/students/${id}/status`, { status });
      setNotice("Student status updated.");
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || "Could not update student status.");
    }
  }

  async function submitPlacementForm(event, endpoint, successMessage, transform = (v) => v) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = transform(Object.fromEntries(new FormData(form).entries()));
    try {
      setError(""); setNotice("");
      const response = await axios.post(`${API}${endpoint}`, values);
      setNotice(response.data?.message || successMessage);
      setShowForm(false); form.reset(); await loadData();
    } catch (err) {
      setError(err.response?.data?.message || `Could not complete action: ${successMessage}`);
    }
  }

  async function updatePlacementStatus(kind, id, status) {
    try {
      setError(""); setNotice("");
      const endpoint = kind === "application" ? `/placement-applications/${id}/status` : `/job-opportunities/${id}/status`;
      const response = await axios.patch(`${API}${endpoint}`, { status });
      setNotice(response.data?.message || "Status updated."); await loadData();
    } catch (err) { setError(err.response?.data?.message || "Could not update status."); await loadData(); }
  }

  async function applyForOpportunity(opportunityId) {
    try {
      setError(""); setNotice("");
      const response = await axios.post(`${API}/placement-applications`, { opportunity_id: Number(opportunityId) });
      setNotice(response.data?.message || "Application submitted."); await loadData();
    } catch (err) { setError(err.response?.data?.message || "Could not submit application."); }
  }

  function navigate(id) {
    setPage(id);
    setSearch("");
    setShowForm(false);
    setError("");
    setNotice("");
    setMobileMenu(false);
  }

  const filteredStudents = students.filter((s) =>
    `${s.first_name} ${s.last_name} ${s.registration_number} ${s.email}`
      .toLowerCase().includes(search.toLowerCase())
  );

  const filteredComplaints = complaints.filter((c) =>
    `${c.subject} ${c.category} ${c.status} ${c.student_name ?? ""}`
      .toLowerCase().includes(search.toLowerCase())
  );

  const visibleNavigation = authUser?.role === "student"
    ? [{ id: "student-home", label: "My Student Portal", icon: GraduationCap }]
    : authUser?.role === "teacher"
      ? navigation.filter((item) => ["dashboard", "students", "academics", "attendance", "complaints", "placements"].includes(item.id))
      : navigation;
  const title = visibleNavigation.find((item) => item.id === page)?.label ?? (authUser?.role === "student" ? "My Student Portal" : "Dashboard");
  const stat = dashboard ?? {};
  // The dashboard API returns flat camelCase fields, so map them directly.
  const studentStats = {
    total_students: stat.totalStudents ?? 0,
    active_students: stat.activeStudents ?? 0,
    graduated_students: stat.graduatedStudents ?? 0,
  };
  const complaintStats = {
    total_complaints: stat.totalComplaints ?? 0,
    submitted_complaints: stat.pendingComplaints ?? 0,
  };
  const placementStats = {
    total_placements: stat.totalPlacements ?? 0,
    average_package: stat.averagePackage ?? null,
  };
  const attendanceStats = {
    attendance_records: stat.totalAttendanceRecords ?? 0,
    overall_attendance_percentage: stat.attendancePercentage ?? null,
  };

  if (authChecking) return <div style={centerScreen}><div style={authCard}><GraduationCap size={36}/><h2>University Analytics</h2><p>Checking your secure session…</p></div></div>;
  if (!authUser) return <AuthScreen setupRequired={setupRequired} onAuthenticated={(user, token) => { localStorage.setItem("unisuccesstoken", token); setAuthUser(user); setPage(user.role === "student" ? "student-home" : "dashboard"); setError(""); }} />;

  return (
    <div className="app-shell">
      {mobileMenu && <button className="mobile-overlay" onClick={() => setMobileMenu(false)} aria-label="Close menu" />}

      <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><GraduationCap size={24} /></div>
          <div><strong>University Analytics</strong><span>University Analytics System</span></div>
          <button className="mobile-close" onClick={() => setMobileMenu(false)} aria-label="Close navigation"><X /></button>
        </div>

        <div className="nav-label">WORKSPACE</div>
        <nav>
          {visibleNavigation.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${page === id ? "active" : ""}`} onClick={() => navigate(id)}>
              <Icon size={19} /><span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="connection-dot" />
          <div><strong>API connection</strong><span>localhost:5000</span></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-title">
            <button className="mobile-menu" onClick={() => setMobileMenu(true)} aria-label="Open navigation"><Menu /></button>
            <div><span className="eyebrow">UNIVERSITY MANAGEMENT</span><h1>{title}</h1></div>
          </div>
          <div className="top-actions">
            <span className="system-status"><span /> {authUser.role.toUpperCase()}</span>
            <span className="account-name">{authUser.name}</span>
            <button className="icon-button" onClick={() => { setShowPasswordForm(true); setError(""); setNotice(""); }} title="Change password"><KeyRound size={18}/></button>
            <button className="icon-button" onClick={loadData} disabled={loading} title="Refresh data"><RefreshCw size={18} className={loading ? "spin" : ""} /></button>
            <button className="icon-button" onClick={() => { localStorage.removeItem("unisuccesstoken"); setAuthUser(null); setStudentPortal(null); setPage("dashboard"); }} title="Log out"><LogOut size={18}/></button>
          </div>
        </header>

        <section className="content">
          {error && <div className="alert error-alert"><AlertCircle size={18} /><span>{error}</span><button onClick={() => setError("")}>×</button></div>}
          {notice && <div className="alert success-alert"><CheckCircle2 size={18} /><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div>}

          {showPasswordForm && <div className="panel" style={{maxWidth:560, margin:"0 auto 22px"}}><div className="panel-heading"><div><h3>Change your password</h3><p>Use your temporary password for the current password field the first time.</p></div><button className="secondary-button" type="button" onClick={()=>setShowPasswordForm(false)}>Close</button></div><form className="record-form" onSubmit={async event=>{event.preventDefault();const form=event.currentTarget;const values=Object.fromEntries(new FormData(form).entries());try{await axios.patch(`${API}/auth/change-password`,values);setNotice("Password changed successfully. Use your new password next time you sign in.");setError("");setShowPasswordForm(false);form.reset();}catch(err){setError(err.response?.data?.message||"Could not change password.");}}}><div className="form-grid"><Field label="Current password" name="current_password" type="password" required/><Field label="New password (8+ characters)" name="new_password" type="password" min={8} required/></div><FormButtons onCancel={()=>setShowPasswordForm(false)}/></form></div>}

          {page === "dashboard" && (
            <>
              <div className="welcome-row">
                <div><h2>University overview</h2><p>Live information from your university database.</p></div>
                <button className="secondary-button" onClick={loadData}><RefreshCw size={16} /> Refresh data</button>
              </div>
              <div className="stats-grid">
                <StatCard icon={Users} label="Total students" value={studentStats.total_students} note={`${formatNumber(studentStats.active_students)} active`} tone="blue" />
                <StatCard icon={MessageSquareWarning} label="Total complaints" value={complaintStats.total_complaints} note={`${formatNumber(complaintStats.submitted_complaints)} submitted`} tone="orange" />
                <StatCard icon={CalendarCheck} label="Attendance records" value={attendanceStats.attendance_records} note={attendanceStats.overall_attendance_percentage == null ? "No attendance data yet" : `${attendanceStats.overall_attendance_percentage}% overall`} tone="green" />
                <StatCard icon={BriefcaseBusiness} label="Placements" value={placementStats.total_placements} note={placementStats.average_package == null ? "No package data yet" : `Average ₹${placementStats.average_package}`} tone="purple" />
              </div>

              <div className="dashboard-grid">
                <div className="panel">
                  <div className="panel-heading"><div><h3>Academic structure</h3><p>Departments and courses registered</p></div><GraduationCap size={21} /></div>
                  <div className="structure-grid">
                    <div className="structure-item"><span>Departments</span><strong>{formatNumber(stat.totalDepartments)}</strong></div>
                    <div className="structure-item"><span>Courses</span><strong>{formatNumber(stat.totalCourses)}</strong></div>
                    <div className="structure-item"><span>Graduated students</span><strong>{formatNumber(studentStats.graduated_students)}</strong></div>
                  </div>
                  <div className="panel-foot">Statistics are retrieved from MySQL through your Express API.</div>
                </div>
                <div className="panel">
                  <div className="panel-heading"><div><h3>Quick actions</h3><p>Go directly to a module</p></div></div>
                  <div className="quick-actions">
                    {authUser.role === "admin" && <button onClick={() => { navigate("students"); setShowForm(true); }}><Plus size={17} /> Add a student</button>}
                    {authUser.role === "admin" && <button onClick={() => { navigate("complaints"); setShowForm(true); }}><Plus size={17} /> Submit a complaint</button>}
                    <button onClick={() => navigate("academics")}><GraduationCap size={17} /> Academic records</button>
                    <button onClick={() => navigate("attendance")}><CalendarCheck size={17} /> Attendance records</button>
                  </div>
                </div>
              </div>

              <div className="panel recent-panel">
                <div className="panel-heading"><div><h3>Recent students</h3><p>Latest records from the student database</p></div><button className="text-button" onClick={() => navigate("students")}>View all →</button></div>
                <StudentTable students={students.slice(0, 5)} onStatusChange={updateStudentStatus} canChange={authUser.role === "admin"} />
              </div>
            </>
          )}

          {page === "students" && (
            <ModulePanel title="Student records" description={`${students.length} student records found`} showForm={showForm} setShowForm={setShowForm} onRefresh={loadData} onAdd={authUser.role === "admin" ? () => setShowForm(true) : undefined} search={search} setSearch={setSearch}>
              {showForm && <form className="record-form" onSubmit={submitForm}>
                <h3>Add student</h3>
                <div className="form-grid">
                  <Field label="Registration number" name="registration_number" required />
                  <Field label="First name" name="first_name" required />
                  <Field label="Last name" name="last_name" required />
                  <Field label="Email" name="email" type="email" required />
                  <Field label="Admission date" name="admission_date" type="date" required />
                  <Field label="Department" name="department_name" placeholder="e.g. Computer Science" required maxLength={100} />
                  <Field label="Course" name="course_name" placeholder="e.g. MCA / B.Tech CSE" required maxLength={100} />
                </div>
                <FormButtons onCancel={() => setShowForm(false)} />
              </form>}
              <StudentTable students={filteredStudents} onStatusChange={updateStudentStatus} canChange={authUser.role === "admin"} />
            </ModulePanel>
          )}

          {page === "complaints" && (
            <ModulePanel title="Complaint management" description={`${complaints.length} complaint records`} showForm={showForm} setShowForm={setShowForm} onRefresh={loadData} onAdd={authUser.role === "admin" ? () => setShowForm(true) : undefined} search={search} setSearch={setSearch}>
              {showForm && <form className="record-form" onSubmit={submitForm}>
                <h3>Submit complaint</h3>
                <div className="form-grid">
                  <SelectField label="Student" name="student_id" options={students.map(s => ({ value: s.student_id, label: `${s.registration_number} — ${s.first_name} ${s.last_name}` }))} required />
                  <SelectField label="Category" name="category" options={["academic","administration","hostel","fees","library","infrastructure","other"].map(x => ({value:x,label:x}))} required />
                  <Field label="Subject" name="subject" required />
                  <SelectField label="Priority" name="priority" options={["low","medium","high"].map(x => ({value:x,label:x}))} required />
                  <div className="field full-field"><label>Description</label><textarea name="description" rows="3" required minLength="10" /></div>
                </div>
                <FormButtons onCancel={() => setShowForm(false)} />
              </form>}
              <div className="table-wrap"><table><thead><tr><th>Student</th><th>Complaint</th><th>Category</th><th>Priority</th><th>Status</th><th>Update status</th></tr></thead>
                <tbody>{filteredComplaints.map(c => <tr key={c.complaint_id}><td>{c.student_name ?? (c.student_id ? `Student ${c.student_id}` : "—")}<small>{c.registration_number ?? (c.student_id ? `ID: ${c.student_id}` : "")}</small></td><td><strong>{c.subject}</strong><small>{c.description}</small></td><td>{c.category}</td><td><StatusPill value={c.priority} /></td><td><StatusPill value={c.status} /></td><td>{authUser.role === "admin" ? <select value={c.status} onChange={e => updateComplaint(c.complaint_id,e.target.value)}><option value="submitted">Submitted</option><option value="under_review">Under review</option><option value="resolved">Resolved</option><option value="rejected">Rejected</option></select> : <span className="muted-note">View only</span>}</td></tr>)}
                {filteredComplaints.length === 0 && <EmptyRow columns={6} text="No complaints found." />}</tbody></table></div>
            </ModulePanel>
          )}

          {page === "academics" && (
            <ModulePanel title="Academic performance" description={`${academic.length} academic records`} showForm={showForm} setShowForm={setShowForm} onRefresh={loadData} onAdd={() => setShowForm(true)} search={search} setSearch={setSearch}>
              {showForm && <form className="record-form" onSubmit={submitForm}><h3>Record marks</h3><div className="form-grid">
                <SelectField label="Student" name="student_id" options={students.map(s => ({value:s.student_id,label:`${s.registration_number} — ${s.first_name} ${s.last_name}`}))} required />
                <Field label="Subject name" name="subject_name" placeholder="e.g. Artificial Intelligence" required maxLength="150" />
                <SelectField label="Exam type" name="exam_type" options={["internal","midterm","endterm","practical"].map(x=>({value:x,label:x}))} required />
                <Field label="Marks obtained" name="marks_obtained" type="number" required />
                <Field label="Exam date" name="exam_date" type="date" required />
              </div><FormButtons onCancel={() => setShowForm(false)} /></form>}
              <div className="table-wrap"><table><thead><tr><th>Student</th><th>Registration no.</th><th>Subject</th><th>Exam type</th><th>Marks</th><th>Exam date</th></tr></thead><tbody>
                {academic.filter(a => `${a.first_name ?? ""} ${a.last_name ?? ""} ${a.registration_number ?? ""} ${a.student_id} ${a.subject_name ?? ""} ${a.exam_type}`.toLowerCase().includes(search.toLowerCase())).map(a=><tr key={a.performance_id}><td><strong>{`${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || `Student ${a.student_id}`}</strong><small>ID: {a.student_id}</small></td><td>{a.registration_number ?? "—"}</td><td>{a.subject_name ?? `Subject ${a.subject_id}`}</td><td>{a.exam_type}</td><td><strong>{a.marks_obtained}</strong></td><td>{String(a.exam_date ?? "").slice(0,10)}</td></tr>)}
                {academic.length===0 && <EmptyRow columns={6} text="No academic records yet." />}
              </tbody></table></div>
              <p className="helper-note">Type any subject name. If it already exists for the student's course, it will be reused; otherwise, the system creates it automatically with a default maximum of 100 and pass mark of 40. No need to add the subject separately.</p>
            </ModulePanel>
          )}

          {page === "attendance" && (
            <ModulePanel title="Attendance management" description={`${attendance.length} attendance records`} showForm={showForm} setShowForm={setShowForm} onRefresh={loadData} onAdd={() => setShowForm(true)} search={search} setSearch={setSearch}>
              {showForm && <form className="record-form" onSubmit={submitForm}><h3>Record attendance</h3><div className="form-grid">
                <SelectField label="Student" name="student_id" options={students.map(s=>({value:s.student_id,label:`${s.registration_number} — ${s.first_name} ${s.last_name}`}))} required />
                <Field label="Subject name" name="subject_name" placeholder="e.g. Database Management Systems" required maxLength="150" />
                <Field label="Attendance date" name="attendance_date" type="date" required />
                <SelectField label="Status" name="status" options={["present","absent","late","excused"].map(x=>({value:x,label:x}))} required />
              </div><FormButtons onCancel={() => setShowForm(false)} /></form>}
              <div className="table-wrap"><table><thead><tr><th>Student</th><th>Registration no.</th><th>Subject</th><th>Date</th><th>Status</th></tr></thead><tbody>
                {attendance.filter(a=>`${a.first_name ?? ""} ${a.last_name ?? ""} ${a.registration_number ?? ""} ${a.student_id} ${a.subject_name ?? ""} ${a.status} ${a.attendance_date}`.toLowerCase().includes(search.toLowerCase())).map(a=><tr key={a.attendance_id}><td><strong>{`${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || `Student ${a.student_id}`}</strong><small>ID: {a.student_id}</small></td><td>{a.registration_number ?? "—"}</td><td>{a.subject_name ?? subjects.find(subject => Number(subject.subject_id) === Number(a.subject_id))?.name ?? `Subject ${a.subject_id}`}</td><td>{String(a.attendance_date??"").slice(0,10)}</td><td><StatusPill value={a.status}/></td></tr>)}
                {attendance.length===0 && <EmptyRow columns={5} text="No attendance records yet." />}
              </tbody></table></div>
              <p className="helper-note">Type the subject name manually. The system reuses a matching subject for the selected student's course or creates it automatically (maximum 100, pass mark 40). Attendance percentages depend on recorded sessions.</p>
            </ModulePanel>
          )}

          {page === "student-home" && studentPortal && (
            <StudentPortal data={studentPortal} onToggle={() => setShowForm(value => !value)} showForm={showForm} onSubmit={submitForm} onCancel={() => setShowForm(false)} onApply={applyForOpportunity} />
          )}

          {page === "accounts" && authUser.role === "admin" && (
            <ModulePanel title="User accounts" description={`${accounts.length} role-based accounts`} showForm={showForm} setShowForm={setShowForm} onRefresh={loadData} onAdd={() => setShowForm(!showForm)} search={search} setSearch={setSearch}>
              {showForm && <form className="record-form" onSubmit={async (event) => {
                event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form).entries());
                try { const response = await axios.post(`${API}/users`, { ...values, student_id: values.role === "student" ? Number(values.student_id) : null, faculty_id: values.role === "teacher" && values.faculty_id ? Number(values.faculty_id) : null, password: values.role === "student" ? undefined : values.password }); setNotice(response.data.message || "Account created successfully."); setShowForm(false); form.reset(); await loadData(); }
                catch (err) { setError(err.response?.data?.message || "Could not create account."); }
              }}>
                <h3>Create teacher or student account</h3><div className="form-grid">
                  <Field label="Full name" name="name" required maxLength={150}/><Field label="Email (must match the student record email for Student)" name="email" type="email" required/>
                  <SelectField label="Role" name="role" options={[{value:"teacher",label:"Teacher"},{value:"student",label:"Student"}]} required/><Field label="Teacher password (not needed for Student)" name="password" type="password" min={8}/>
                  <SelectField label="Link to student record (required for Student)" name="student_id" options={students.map(s=>({value:String(s.student_id),label:`${s.registration_number} — ${s.first_name} ${s.last_name}`}))} />
                  <SelectField label="Teacher department (required for new Teacher account)" name="department_id" options={departments.map(d=>({value:String(d.department_id),label:`${d.name} (${d.code})`}))} />
                  <Field label="Existing Faculty ID (optional; leave blank to create faculty record automatically)" name="faculty_id" type="number" min={1}/>
                </div><p className="helper-note">For Student accounts, select the existing student record and use the same email stored in that record. The system generates a temporary password and emails the registration number, login email, course, department and temporary password; SMTP must be configured in backend .env. Students can change the temporary password using the key icon after signing in. For Teacher accounts, enter a password, then choose the department or existing Faculty ID.</p><FormButtons onCancel={() => setShowForm(false)}/>
              </form>}
              <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Linked record</th><th>Status</th></tr></thead><tbody>
                {accounts.filter(u => `${u.name} ${u.email} ${u.role} ${u.student_name??""} ${u.faculty_name??""}`.toLowerCase().includes(search.toLowerCase())).map(u => <tr key={u.user_id}><td><strong>{u.name}</strong></td><td>{u.email}</td><td><select aria-label={`Change role for ${u.name}`} value={u.role} onChange={async e => { const nextRole = e.target.value; if (nextRole === u.role) return; if (!window.confirm(`Change ${u.name}'s role to ${nextRole.toUpperCase()}?`)) { e.target.value = u.role; return; } try { await axios.patch(`${API}/users/${u.user_id}/role`, { role: nextRole }); setNotice(`${u.name}'s role changed to ${nextRole}. They may need to sign in again.`); await loadData(); } catch(err) { setError(err.response?.data?.message || "Could not change account role."); await loadData(); } }}><option value="admin">Admin</option><option value="teacher">Teacher</option><option value="student">Student</option></select></td><td>{u.role === "student" ? <div style={{display:"grid",gap:6,minWidth:220}}><span>{u.student_name || `Not linked (ID ${u.student_id || "—"})`}</span><select aria-label={`Link student record for ${u.name}`} value={u.student_id ? String(u.student_id) : ""} onChange={async e => { const nextStudentId = e.target.value; if (!nextStudentId) return; try { await axios.patch(`${API}/users/${u.user_id}/link`, {student_id:Number(nextStudentId)}); setNotice(`Student account ${u.email} linked successfully.`); await loadData(); } catch(err) { setError(err.response?.data?.message || "Could not update student link."); } }}><option value="" disabled>Select correct student…</option>{students.map(s=><option key={s.student_id} value={String(s.student_id)}>{s.registration_number} — {s.first_name} {s.last_name}</option>)}</select></div> : (u.faculty_name || (u.role === "admin" ? "University" : `ID ${u.faculty_id || "—"}`))}</td><td><StatusPill value={Number(u.is_active) ? "active" : "inactive"}/></td></tr>)}
                {accounts.length === 0 && <EmptyRow columns={5} text="No accounts found."/>}
              </tbody></table></div>
            </ModulePanel>
          )}

          {page === "placements" && authUser.role === "admin" && (
            <ModulePanel title="Placement management" description={`${companies.length} companies · ${opportunities.length} opportunities · ${placementApplications.length} applications · ${placements.length} placements`} onRefresh={loadData} search={search} setSearch={setSearch} onAdd={() => setShowForm(!showForm)} showForm={showForm} setShowForm={setShowForm}>
              {showForm && <div className="record-form">
                <h3>Add company</h3>
                <form onSubmit={(e) => submitPlacementForm(e, "/companies", "Company added.")}>
                  <div className="form-grid"><Field label="Company name" name="name" required maxLength={200}/><Field label="Industry" name="industry" maxLength={100} placeholder="e.g. IT Services"/><Field label="Website" name="website" maxLength={255} placeholder="https://example.com"/></div><FormButtons onCancel={() => setShowForm(false)}/>
                </form>
                <hr/><h3>Publish job opportunity</h3>
                <form onSubmit={(e) => submitPlacementForm(e, "/job-opportunities", "Job opportunity published.", v => ({...v, company_id:Number(v.company_id), minimum_cgpa:v.minimum_cgpa === "" ? null : Number(v.minimum_cgpa)}))}>
                  <div className="form-grid"><SelectField label="Company" name="company_id" options={companies.map(c=>({value:String(c.company_id),label:c.name}))} required/><Field label="Job title" name="title" required maxLength={150} placeholder="e.g. Graduate Trainee"/><SelectField label="Job type" name="job_type" options={[{value:"full_time",label:"Full time"},{value:"internship",label:"Internship"},{value:"part_time",label:"Part time"}]} required/><Field label="Minimum CGPA (0–10)" name="minimum_cgpa" type="number" min="0" max="10" step="0.01"/><Field label="Application deadline" name="application_deadline" type="date"/><SelectField label="Status" name="status" options={[{value:"open",label:"Open"},{value:"closed",label:"Closed"},{value:"cancelled",label:"Cancelled"}]} required/></div><FormButtons onCancel={() => setShowForm(false)}/>
                </form>
                <p className="helper-note">Company and job forms are separate. Add a company first, then publish a job for that company.</p>
              </div>}
              <h3>Job opportunities</h3><div className="table-wrap"><table><thead><tr><th>Job</th><th>Company</th><th>Type</th><th>Min CGPA</th><th>Deadline</th><th>Status</th></tr></thead><tbody>
                {opportunities.filter(o=>`${o.title} ${o.company_name} ${o.job_type} ${o.status}`.toLowerCase().includes(search.toLowerCase())).map(o=><tr key={o.opportunity_id}><td>{o.title}</td><td>{o.company_name}</td><td>{o.job_type}</td><td>{o.minimum_cgpa ?? "—"}</td><td>{String(o.application_deadline||"").slice(0,10) || "—"}</td><td><select value={o.status} onChange={e=>updatePlacementStatus("job",o.opportunity_id,e.target.value)}><option value="open">Open</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option></select></td></tr>)}{!opportunities.length&&<EmptyRow columns={6} text="No job opportunities yet. Add a company and publish a job."/>}
              </tbody></table></div>
              <h3>Student applications</h3><div className="table-wrap"><table><thead><tr><th>Student</th><th>Registration</th><th>Job</th><th>Company</th><th>Applied</th><th>Status</th></tr></thead><tbody>
                {placementApplications.filter(a=>`${a.student_name} ${a.registration_number} ${a.job_title} ${a.company_name} ${a.status}`.toLowerCase().includes(search.toLowerCase())).map(a=><tr key={a.application_id}><td>{a.student_name}</td><td>{a.registration_number}</td><td>{a.job_title}</td><td>{a.company_name}</td><td>{String(a.applied_at||"").slice(0,10)}</td><td><select value={a.status} onChange={e=>updatePlacementStatus("application",a.application_id,e.target.value)}>{["applied","shortlisted","interview","offered","rejected","accepted"].map(v=><option key={v} value={v}>{v}</option>)}</select></td></tr>)}{!placementApplications.length&&<EmptyRow columns={6} text="No student applications yet."/>}
              </tbody></table></div>
              <h3>Record a confirmed placement</h3><form className="record-form" onSubmit={(e)=>submitPlacementForm(e,"/placements","Placement recorded.",v=>({...v,application_id:Number(v.application_id),package_amount:v.package_amount===""?null:Number(v.package_amount)}))}>
                <div className="form-grid"><SelectField label="Offered/accepted application" name="application_id" options={placementApplications.filter(a=>["offered","accepted"].includes(a.status)).map(a=>({value:String(a.application_id),label:`#${a.application_id} — ${a.student_name} · ${a.company_name} · ${a.job_title}`}))} required/><Field label="Annual package (₹)" name="package_amount" type="number" min="0" step="0.01"/><Field label="Placement date" name="placement_date" type="date"/></div><FormButtons onCancel={()=>{}}/>
              </form>
              <h3>Recorded placements</h3><div className="table-wrap"><table><thead><tr><th>ID</th><th>Student</th><th>Company</th><th>Job</th><th>Package (₹)</th><th>Date</th></tr></thead><tbody>
                {placements.filter(p=>`${p.placement_id} ${p.student_name??""} ${p.company_name??""} ${p.job_title??""}`.toLowerCase().includes(search.toLowerCase())).map(p=><tr key={p.placement_id}><td>{p.placement_id}</td><td>{p.student_name??`Student ${p.student_id??"—"}`}</td><td>{p.company_name??"—"}</td><td>{p.job_title??"—"}</td><td>{p.package_amount==null?"—":`₹${p.package_amount}`}</td><td>{String(p.placement_date??"").slice(0,10)}</td></tr>)}{!placements.length&&<EmptyRow columns={6} text="No placements recorded yet."/>}
              </tbody></table></div>
            </ModulePanel>
          )}
        </section>
        <footer className="footer"><span>University Analytics System</span><span>React · Express · MySQL</span></footer>
      </main>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, note, tone }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon size={21}/></div><span className="stat-label">{label}</span><strong className="stat-value">{formatNumber(value)}</strong><span className="stat-note">{note}</span></div>;
}

function ModulePanel({ title, description, children, showForm, setShowForm, onRefresh, onAdd, search, setSearch }) {
  return <div className="module-panel">
    <div className="module-toolbar"><div><h2>{title}</h2><p>{description}</p></div><div className="toolbar-actions">
      <div className="search-box"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search records..." /></div>
      <button className="icon-button" onClick={onRefresh} title="Refresh"><RefreshCw size={17}/></button>
      {onAdd && <button className="primary-button" onClick={()=>setShowForm(!showForm)}><Plus size={17}/>{showForm?"Close form":"Add new"}</button>}
    </div></div>
    {children}
  </div>;
}

function StudentTable({ students, onStatusChange, canChange = true }) {
  return <div className="table-wrap"><table><thead><tr><th>Student</th><th>Registration no.</th><th>Department</th><th>Course</th><th>Status</th><th>Change status</th></tr></thead><tbody>
    {students.map(s=><tr key={s.student_id}><td><div className="student-cell"><div className="avatar">{`${s.first_name?.[0]??""}${s.last_name?.[0]??""}`}</div><div><strong>{s.first_name} {s.last_name}</strong><small>{s.email}</small></div></div></td><td>{s.registration_number}</td><td>{s.department_name??"—"}</td><td>{s.course_name??"—"}</td><td><StatusPill value={s.status}/></td><td>{canChange ? <select value={s.status} onChange={e=>onStatusChange(s.student_id,e.target.value)}><option value="active">Active</option><option value="graduated">Graduated</option><option value="suspended">Suspended</option><option value="withdrawn">Withdrawn</option></select> : <span className="muted-note">View only</span>}</td></tr>)}
    {students.length===0 && <EmptyRow columns={6} text="No student records found."/>}
  </tbody></table></div>;
}

function Field({ label, name, type="text", required=false, placeholder, maxLength, min, max, step }) {
  return <div className="field"><label htmlFor={name}>{label}{required?" *":""}</label><input id={name} name={name} type={type} required={required} placeholder={placeholder} maxLength={maxLength} min={min} max={max} step={step} /></div>;
}

function SelectField({ label, name, options, required=false }) {
  return <div className="field"><label htmlFor={name}>{label}{required?" *":""}</label><select id={name} name={name} required={required} defaultValue=""><option value="" disabled>Select {label.toLowerCase()}</option>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></div>;
}

function FormButtons({ onCancel }) {
  return <div className="form-actions"><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button><button type="submit" className="primary-button"><CheckCircle2 size={16}/> Save record</button></div>;
}

function StatusPill({ value }) {
  return <span className={`status-pill status-${String(value??"unknown").toLowerCase().replace(/[^a-z0-9_-]/g,"-")}`}>{String(value??"unknown").replaceAll("_"," ")}</span>;
}

function EmptyRow({ columns, text }) {
  return <tr><td colSpan={columns} className="empty-cell">{text}</td></tr>;
}


const centerScreen = { minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px", background: "#f4f7fb", fontFamily: "Inter, system-ui, sans-serif" };
const authCard = { width: "min(440px, 100%)", background: "white", borderRadius: "20px", padding: "32px", boxShadow: "0 18px 55px rgba(20,40,80,.12)", color: "#172033" };
const authInput = { width: "100%", boxSizing: "border-box", padding: "12px 13px", border: "1px solid #d7deea", borderRadius: "9px", marginTop: "6px", font: "inherit" };

function AuthScreen({ setupRequired, onAuthenticated }) {
  const [mode, setMode] = useState(setupRequired ? "setup" : "login");
  const [role, setRole] = useState("student");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    setBusy(true); setMessage("");
    try {
      if (mode === "register") {
        await axios.post(`${API}/auth/student-register`, values);
        setMode("login");
        setRole("student");
        setMessage("Student account created. You can now sign in.");
      } else {
        if (mode === "login") values.role = role;
        const response = await axios.post(`${API}/auth/${mode === "setup" ? "setup" : "login"}`, values);
        onAuthenticated(response.data.data.user, response.data.data.token);
      }
    } catch (err) { setMessage(err.response?.data?.message || "Could not connect to the server. Make sure the backend is running."); }
    finally { setBusy(false); }
  }
  const isRegister = mode === "register";
  return <div style={centerScreen}><form onSubmit={submit} style={authCard}>
    <div style={{ display:"flex", alignItems:"center", gap:12, color:"#3157c8" }}><GraduationCap size={36}/><div><h1 style={{ margin:0, fontSize:25, color:"#172033" }}>University Analytics</h1><span style={{ color:"#64748b", fontSize:13 }}>University Analytics System</span></div></div>
    <h2 style={{ marginTop:28, marginBottom:6 }}>{mode === "setup" ? "Create the first Admin" : isRegister ? "Create student account" : "Sign in to your portal"}</h2>
    <p style={{ color:"#64748b", lineHeight:1.5, marginTop:0 }}>{mode === "setup" ? "One-time setup. The first account becomes the university administrator." : isRegister ? "Use the registration number and email already recorded by your university." : "Choose your role and sign in with your account."}</p>
    {mode === "login" && !setupRequired && <div style={{ marginTop:18 }}><span style={{ display:"block", fontWeight:600, fontSize:14, marginBottom:8 }}>Login as</span><div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:8 }}>{[{id:"student",label:"Student",Icon:UserRound},{id:"teacher",label:"Teacher",Icon:GraduationCap},{id:"admin",label:"Admin",Icon:ShieldCheck}].map(item=><button key={item.id} type="button" onClick={()=>setRole(item.id)} style={{ border:`1px solid ${role===item.id?"#3157c8":"#d7deea"}`, background:role===item.id?"#edf2ff":"white", color:role===item.id?"#2449b4":"#475569", borderRadius:9, padding:"11px 6px", fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}><item.Icon size={16}/>{item.label}</button>)}</div></div>}
    {mode === "setup" && <label style={{ display:"block", marginTop:15, fontWeight:600, fontSize:14 }}>Full name<input name="name" required maxLength="150" style={authInput} placeholder="Administrator name"/></label>}
    {isRegister && <label style={{ display:"block", marginTop:15, fontWeight:600, fontSize:14 }}>University registration number<input name="registration_number" required maxLength="60" style={authInput} placeholder="e.g. DEMO-MCA-001"/></label>}
    <label style={{ display:"block", marginTop:15, fontWeight:600, fontSize:14 }}>Email<input name="email" type="email" required style={authInput} placeholder="you@university.edu" autoComplete="username"/></label>
    <label style={{ display:"block", marginTop:15, fontWeight:600, fontSize:14 }}>Password<input name="password" type="password" required minLength={mode === "setup" || isRegister ? 8 : undefined} style={authInput} placeholder={mode === "setup" || isRegister ? "At least 8 characters" : "Enter password"} autoComplete={mode === "setup" || isRegister ? "new-password" : "current-password"}/></label>
    {message && <p role="alert" style={{ color:message.includes("created")?"#067647":"#b42318", background:message.includes("created")?"#ecfdf3":"#fff0ef", padding:10, borderRadius:8, fontSize:14 }}>{message}</p>}
    <button type="submit" disabled={busy} style={{ width:"100%", marginTop:22, border:0, borderRadius:9, padding:13, background:"#3157c8", color:"white", fontWeight:700, fontSize:15, cursor:"pointer" }}>{busy ? "Please wait…" : mode === "setup" ? "Create Admin account" : isRegister ? "Create student account" : `Sign in as ${role[0].toUpperCase()+role.slice(1)}`}</button>
    {!setupRequired && <p style={{ marginBottom:0, color:"#64748b", fontSize:13, lineHeight:1.5 }}>{isRegister ? "Teacher and Admin accounts must be created by the university administrator." : "Need access? Students can register using their existing university record. Teachers and Admins should contact the university administrator."}</p>}
    {!setupRequired && <button type="button" onClick={()=>{setMode(isRegister?"login":"register");setMessage("");}} style={{ width:"100%", marginTop:12, border:"1px solid #d7deea", borderRadius:9, padding:12, background:"white", color:"#3157c8", fontWeight:700, cursor:"pointer" }}>{isRegister ? "Back to sign in" : "Create student account"}</button>}
  </form></div>;
}

function StudentPortal({ data, showForm, onSubmit, onCancel, onToggle, onApply }) {
  const student = data.student;
  const validAttendance = Array.isArray(data.attendance)
    ? data.attendance.filter(a => ["present", "absent", "late", "excused"].includes(String(a.status || "").toLowerCase()))
    : [];
  const present = validAttendance.filter(a => ["present", "late"].includes(String(a.status).toLowerCase())).length;
  const attendanceRate = validAttendance.length
    ? Math.round((present / validAttendance.length) * 100)
    : null;
  return <>
    <div className="welcome-row"><div><h2>Welcome, {student.first_name} {student.last_name}</h2><p>{student.registration_number} · {student.course_name || "Course not set"} · {student.department_name || "Department not set"}</p></div><span className="status-pill status-active">{student.status}</span></div>
    <div className="stats-grid"><StatCard icon={GraduationCap} label="Academic records" value={data.academic.length} note="Marks recorded" tone="blue"/><StatCard icon={CalendarCheck} label="Attendance" value={attendanceRate == null ? "—" : `${attendanceRate}%`} note={`${data.attendance.length} recorded sessions`} tone="green"/><StatCard icon={MessageSquareWarning} label="My complaints" value={data.complaints.length} note={`${data.complaints.filter(c=>["submitted","under_review"].includes(c.status)).length} open`} tone="orange"/><StatCard icon={BriefcaseBusiness} label="Open opportunities" value={data.opportunities.length} note={`${data.applications.length} applications`} tone="purple"/></div>
    <div className="dashboard-grid">
      <div className="panel"><div className="panel-heading"><div><h3>My academic performance</h3><p>Only your marks are shown here</p></div></div><div className="table-wrap"><table><thead><tr><th>Subject</th><th>Exam</th><th>Marks</th><th>Date</th></tr></thead><tbody>{data.academic.map(a=><tr key={a.performance_id}><td>{a.subject_name}</td><td>{a.exam_type}</td><td><strong>{a.marks_obtained}</strong> / {a.max_marks}</td><td>{String(a.exam_date||"").slice(0,10)}</td></tr>)}{!data.academic.length&&<EmptyRow columns={4} text="No marks have been published yet."/>}</tbody></table></div></div>
      <div className="panel"><div className="panel-heading"><div><h3>My complaints</h3><p>Track your submitted requests</p></div><button type="button" className="primary-button" onClick={onToggle}>{showForm ? "Close" : "New complaint"}</button></div>
        {showForm && <form className="record-form" onSubmit={onSubmit}><h3>Submit a complaint</h3><div className="form-grid"><SelectField label="Category" name="category" options={["academic","administration","hostel","fees","library","infrastructure","other"].map(v=>({value:v,label:v}))} required/><Field label="Subject" name="subject" required/><SelectField label="Priority" name="priority" options={["low","medium","high"].map(v=>({value:v,label:v}))} required/><div className="field full-field"><label>Description</label><textarea name="description" rows="3" required minLength="10"/></div></div><FormButtons onCancel={onCancel}/></form>}
        <div className="table-wrap"><table><thead><tr><th>Complaint</th><th>Status</th><th>Date</th></tr></thead><tbody>{data.complaints.map(c=><tr key={c.complaint_id}><td><strong>{c.subject}</strong><small>{c.category} · {c.priority}</small></td><td><StatusPill value={c.status}/></td><td>{String(c.created_at||"").slice(0,10)}</td></tr>)}{!data.complaints.length&&<EmptyRow columns={3} text="You have not submitted any complaints."/>}</tbody></table></div>
      </div>
    </div>
    <div className="panel recent-panel"><div className="panel-heading"><div><h3>My attendance</h3><p>Your recorded class attendance</p></div></div><div className="table-wrap"><table><thead><tr><th>Subject</th><th>Date</th><th>Status</th></tr></thead><tbody>{data.attendance.slice(0,20).map(a=><tr key={a.attendance_id}><td>{a.subject_name}</td><td>{String(a.attendance_date||"").slice(0,10)}</td><td><StatusPill value={a.status}/></td></tr>)}{!data.attendance.length&&<EmptyRow columns={3} text="No attendance records yet."/>}</tbody></table></div></div>
    <div className="panel recent-panel"><div className="panel-heading"><div><h3>Placement opportunities</h3><p>Open opportunities and your applications</p></div></div><div className="table-wrap"><table><thead><tr><th>Opportunity</th><th>Type</th><th>Deadline</th><th>Application</th><th>Action</th></tr></thead><tbody>{data.opportunities.map(o=>{const application=data.applications.find(a=>Number(a.opportunity_id)===Number(o.opportunity_id));return <tr key={o.opportunity_id}><td>{o.title}</td><td>{o.job_type}</td><td>{String(o.application_deadline||"").slice(0,10) || "—"}</td><td>{application?<StatusPill value={application.status}/>:"Not applied"}</td><td>{application?"Applied":<button type="button" className="primary-button" onClick={()=>onApply(o.opportunity_id)}>Apply</button>}</td></tr>})}{!data.opportunities.length&&<EmptyRow columns={5} text="No open opportunities currently."/>}</tbody></table></div></div>
  </>;
}

export default App;
