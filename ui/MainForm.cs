using System.Diagnostics;
using System.Text.Json;

namespace YJMusicBot;

public class MainForm : Form
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(3) };
    private const int Port = 8787;

    private readonly TextBox _token = new() { UseSystemPasswordChar = true };
    private readonly TextBox _clientId = new();
    private readonly TextBox _guildId = new();
    private readonly Button _save = new() { Text = "저장" };
    private readonly Button _start = new() { Text = "켜기" };
    private readonly Button _stop = new() { Text = "끄기", Enabled = false };
    private readonly Label _status = new() { Text = "● 오프라인" };
    private readonly Label _tag = new();
    private readonly Label _err = new();
    private readonly ListView _servers = new();
    private readonly System.Windows.Forms.Timer _poll = new() { Interval = 2000 };

    private Process? _bot;
    private bool _starting;

    private static readonly Color Bg = Color.FromArgb(30, 31, 34);
    private static readonly Color Panel = Color.FromArgb(43, 45, 49);
    private static readonly Color Fg = Color.FromArgb(242, 243, 245);
    private static readonly Color Muted = Color.FromArgb(181, 186, 193);
    private static readonly Color Green = Color.FromArgb(35, 165, 90);
    private static readonly Color Red = Color.FromArgb(242, 63, 67);

    private static string CredsPath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "YJMusicBot", "creds.json");

    public MainForm()
    {
        Text = "음악봇 컨트롤 패널";
        ClientSize = new Size(560, 460);
        MinimumSize = new Size(480, 420);
        BackColor = Bg;
        ForeColor = Fg;
        Font = new Font("Segoe UI", 9.5f);

        int m = 16, w = ClientSize.Width - m * 2;

        var title = new Label { Text = "음악봇 컨트롤 패널", Font = new Font("Segoe UI", 14f, FontStyle.Bold), AutoSize = true, Location = new Point(m, m) };

        _status.Font = new Font("Segoe UI", 11f, FontStyle.Bold);
        _status.ForeColor = Red;
        _status.AutoSize = true;
        _status.Location = new Point(m, 52);
        _tag.ForeColor = Muted; _tag.AutoSize = true; _tag.Location = new Point(m + 110, 55);

        _start.SetBounds(w - 150 + m, 48, 70, 30); _start.BackColor = Green; _start.ForeColor = Color.White; _start.FlatStyle = FlatStyle.Flat; _start.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        _stop.SetBounds(w - 74 + m, 48, 70, 30); _stop.BackColor = Red; _stop.ForeColor = Color.White; _stop.FlatStyle = FlatStyle.Flat; _stop.Anchor = AnchorStyles.Top | AnchorStyles.Right;

        _err.ForeColor = Red; _err.AutoSize = false; _err.SetBounds(m, 84, w, 18); _err.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;

        // 자격증명
        var lblT = Mk("봇 토큰", m, 112);
        _token.SetBounds(m, 132, w, 24); Style(_token); _token.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
        var lblC = Mk("Application ID", m, 162);
        _clientId.SetBounds(m, 182, (w - 10) / 2, 24); Style(_clientId);
        var lblG = Mk("서버 ID (선택)", m + (w - 10) / 2 + 10, 162);
        _guildId.SetBounds(m + (w - 10) / 2 + 10, 182, (w - 10) / 2, 24); Style(_guildId); _guildId.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        _clientId.Anchor = AnchorStyles.Top | AnchorStyles.Left;
        lblG.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        _save.SetBounds(m, 214, 64, 26); _save.BackColor = Panel; _save.ForeColor = Fg; _save.FlatStyle = FlatStyle.Flat;

        // 서버 목록
        var lblS = Mk("사용 중인 서버", m, 252);
        _servers.SetBounds(m, 272, w, ClientSize.Height - 272 - m);
        _servers.View = View.Details;
        _servers.FullRowSelect = true;
        _servers.BackColor = Panel;
        _servers.ForeColor = Fg;
        _servers.BorderStyle = BorderStyle.None;
        _servers.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
        _servers.Columns.Add("서버", 200);
        _servers.Columns.Add("멤버", 60);
        _servers.Columns.Add("재생 중", 180);
        _servers.Columns.Add("대기열", 60);

        Controls.AddRange(new Control[] { title, _status, _tag, _start, _stop, _err, lblT, _token, lblC, _clientId, lblG, _guildId, _save, lblS, _servers });

        _save.Click += (_, _) => SaveCreds();
        _start.Click += async (_, _) => await StartBot();
        _stop.Click += (_, _) => StopBot();
        _poll.Tick += async (_, _) => await Poll();
        FormClosing += (_, _) => KillBot();

        LoadCreds();

        // 테스트용: YJ_AUTOSTART=1 이면 로드 직후 자동으로 봇 시작
        if (Environment.GetEnvironmentVariable("YJ_AUTOSTART") == "1")
            Shown += async (_, _) => await StartBot();
    }

    private static Label Mk(string t, int x, int y) => new() { Text = t, ForeColor = Muted, AutoSize = true, Location = new Point(x, y) };
    private static void Style(TextBox t) { t.BackColor = Color.FromArgb(49, 51, 56); t.ForeColor = Fg; t.BorderStyle = BorderStyle.FixedSingle; }

    private void LoadCreds()
    {
        try
        {
            var j = JsonDocument.Parse(File.ReadAllText(CredsPath)).RootElement;
            _token.Text = j.TryGetProperty("token", out var a) ? a.GetString() : "";
            _clientId.Text = j.TryGetProperty("clientId", out var b) ? b.GetString() : "";
            _guildId.Text = j.TryGetProperty("guildId", out var c) ? c.GetString() : "";
        }
        catch { }
    }

    private void SaveCreds()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(CredsPath)!);
            var obj = new { token = _token.Text.Trim(), clientId = _clientId.Text.Trim(), guildId = _guildId.Text.Trim() };
            File.WriteAllText(CredsPath, JsonSerializer.Serialize(obj));
            _err.ForeColor = Green; _err.Text = "저장됨";
        }
        catch (Exception ex) { _err.ForeColor = Red; _err.Text = ex.Message; }
    }

    private async Task StartBot()
    {
        _err.Text = "";
        if (string.IsNullOrWhiteSpace(_token.Text) || string.IsNullOrWhiteSpace(_clientId.Text))
        {
            _err.ForeColor = Red; _err.Text = "봇 토큰과 Application ID를 입력하세요.";
            return;
        }
        SaveCreds(); _err.Text = "";
        _starting = true; _start.Enabled = false; _status.Text = "● 켜는 중..."; _status.ForeColor = Muted;

        try
        {
            var botExe = Path.Combine(AppContext.BaseDirectory, "bot", "bot.exe");
            var psi = new ProcessStartInfo
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            if (File.Exists(botExe)) { psi.FileName = botExe; psi.WorkingDirectory = Path.GetDirectoryName(botExe)!; }
            else { psi.FileName = "node"; psi.Arguments = "headless.js"; psi.WorkingDirectory = Environment.GetEnvironmentVariable("YJ_BOT_DIR") ?? AppContext.BaseDirectory; }
            psi.EnvironmentVariables["BOT_TOKEN"] = _token.Text.Trim();
            psi.EnvironmentVariables["CLIENT_ID"] = _clientId.Text.Trim();
            psi.EnvironmentVariables["GUILD_ID"] = _guildId.Text.Trim();

            _bot = new Process { StartInfo = psi, EnableRaisingEvents = true };
            _bot.OutputDataReceived += (_, e) => { if (e.Data != null) OnBotLog(e.Data); };
            _bot.ErrorDataReceived += (_, e) => { if (e.Data != null) OnBotLog(e.Data); };
            _bot.Exited += (_, _) => BeginInvoke(OnBotExited);
            _bot.Start();
            _bot.BeginOutputReadLine();
            _bot.BeginErrorReadLine();
            _poll.Start();
        }
        catch (Exception ex)
        {
            _starting = false; _start.Enabled = true;
            _status.Text = "● 오프라인"; _status.ForeColor = Red;
            _err.ForeColor = Red; _err.Text = "봇 실행 실패: " + ex.Message;
        }
    }

    private void OnBotLog(string line)
    {
        if (line.StartsWith("START_FAIL"))
        {
            BeginInvoke(() =>
            {
                _err.ForeColor = Red;
                _err.Text = line.Length > 11 ? line.Substring(11) : "봇 시작 실패 (토큰 확인)";
            });
        }
    }

    private void OnBotExited()
    {
        _poll.Stop();
        _bot = null; _starting = false;
        _start.Enabled = true; _stop.Enabled = false;
        _status.Text = "● 오프라인"; _status.ForeColor = Red;
        _tag.Text = ""; _servers.Items.Clear();
    }

    private void StopBot()
    {
        KillBot();
        OnBotExited();
    }

    private void KillBot()
    {
        try { _bot?.Kill(entireProcessTree: true); } catch { }
        _bot = null;
    }

    private async Task Poll()
    {
        try
        {
            var json = await Http.GetStringAsync($"http://localhost:{Port}/status");
            var s = JsonDocument.Parse(json).RootElement;
            bool online = s.GetProperty("online").GetBoolean();
            if (online)
            {
                _starting = false;
                _start.Enabled = false; _stop.Enabled = true;
                _status.Text = "● 온라인"; _status.ForeColor = Green;
                _tag.Text = s.TryGetProperty("tag", out var t) ? t.GetString() ?? "" : "";
                RenderServers(s.GetProperty("guilds"));
            }
            else if (!_starting)
            {
                _stop.Enabled = true; // 프로세스는 떠 있으니 끌 수 있게
            }
        }
        catch { /* 아직 서버 준비 전 */ }
    }

    private void RenderServers(JsonElement guilds)
    {
        _servers.BeginUpdate();
        _servers.Items.Clear();
        foreach (var g in guilds.EnumerateArray())
        {
            string name = g.GetProperty("name").GetString() ?? "";
            string members = g.TryGetProperty("memberCount", out var mc) && mc.ValueKind == JsonValueKind.Number ? mc.GetInt32().ToString() : "-";
            string playing = g.TryGetProperty("playing", out var p) && p.ValueKind == JsonValueKind.String ? p.GetString()! : "—";
            bool paused = g.TryGetProperty("paused", out var pz) && pz.ValueKind == JsonValueKind.True;
            if (playing != "—" && paused) playing = "(일시정지) " + playing;
            int queued = g.TryGetProperty("queued", out var q) && q.ValueKind == JsonValueKind.Number ? q.GetInt32() : 0;
            var it = new ListViewItem(new[] { name, members, playing, queued > 0 ? queued + "곡" : "-" });
            _servers.Items.Add(it);
        }
        _servers.EndUpdate();
    }
}
