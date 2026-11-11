# 프로토타입 API 키 메뉴: API_KEYS.bat 을 더블클릭하면 열려요.
# 서비스를 고르고 키를 붙여 넣으면 API_KEYS.bat 에 저장하고, 그 키가 지금 되는지 바로 시험해 줘요.
param([Parameter(Mandatory = $true)][string]$KeyFile)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# Read-Host 대신 한 줄 읽기 (붙여 넣기도 되고, 입력이 파일에서 와도 동작)
function Read-Line([string]$prompt) {
  Write-Host ($prompt + ' : ') -NoNewline
  return [Console]::ReadLine()
}
$cp949 = [System.Text.Encoding]::GetEncoding(949)
$script:enc = $cp949

# 줄 이름(파일에 적히는 모양)과 설명. 날씨는 이미 있으면 메뉴에서 빠져요.
$Svc = @(
  @{ id = 'weather'; short = '날씨';   label = '날씨 (기상청_단기예보 ((구)_동네예보) 조회서비스)'; desc = '기상청 날씨'; site = 'data.go.kr' },
  @{ id = 'bus';     short = '버스';   label = '버스 (국토교통부_(TAGO)_버스도착정보 · 버스정류소정보)'; desc = '전국 버스 도착 정보'; site = 'data.go.kr' },
  @{ id = 'subway';  short = '지하철'; label = '지하철 (국토교통부_(TAGO)_지하철정보)'; desc = '전국 지하철 시간표'; site = 'data.go.kr' },
  @{ id = 'signal';  short = '신호등'; label = '신호등 (행정안전부 한국지역정보개발원_(전국 통합데이터) 교통안전 신호등 실시간 정보)'; desc = '신호등 실시간 정보'; site = 'data.go.kr' },
  @{ id = 'kakao';   short = '카카오'; label = '카카오 (REST API 키 · developers.kakao.com)'; desc = '전국 주소·장소 검색 (선택)'; site = 'kakao' }
)

function Load-Text {
  $bytes = [System.IO.File]::ReadAllBytes($KeyFile)
  try {
    $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
    $t = $utf8.GetString($bytes)
    $script:enc = New-Object System.Text.UTF8Encoding($false)
  } catch {
    $t = $cp949.GetString($bytes)
    $script:enc = $cp949
  }
  return $t.TrimStart([char]0xFEFF)
}
function Load-Lines { return @((Load-Text) -split "`r?`n") }
function Save-Lines($lines) {
  $text = ($lines -join "`r`n")
  [System.IO.File]::WriteAllBytes($KeyFile, $script:enc.GetBytes($text))
}

# 키 칸에 [대괄호]·"따옴표"가 있어도 벗기고, 두 개 붙여 넣으면 첫 번째만 쓴다. 한글 안내 글자는 키가 아니다.
function Clean-Key([string]$v) {
  if (-not $v) { return '' }
  $trim = [char[]]@('[', ']', '(', ')', '"', "'", ' ', "`t")
  $t = $v.Trim($trim)
  $t = ($t -split '[\s,;]+')[0]
  if (-not $t) { return '' }
  $t = $t.Trim($trim)
  if ($t -match '[가-힣]') { return '' }
  if ($t -match '^(api)?-?key$') { return '' }
  return $t
}
function Line-Index($lines, $s) {
  $pat = '^\s*' + [regex]::Escape($s.short) + '\s*[\(:：]'
  for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match $pat) { return $i } }
  return -1
}
function Get-Value($lines, $s) {
  $i = Line-Index $lines $s
  if ($i -lt 0) { return '' }
  $l = $lines[$i]
  $c = $l.IndexOfAny([char[]]@(':', '：'))
  if ($c -lt 0) { return '' }
  return (Clean-Key $l.Substring($c + 1))
}
function Set-Value($lines, $s, [string]$key) {
  $new = $s.label + ' : ' + $key
  $i = Line-Index $lines $s
  $list = New-Object System.Collections.Generic.List[string]
  $list.AddRange([string[]]$lines)
  if ($i -ge 0) { $list[$i] = $new }
  else {
    $end = $list.Count
    while ($end -gt 0 -and [string]::IsNullOrWhiteSpace($list[$end - 1])) { $end-- }
    $list.Insert($end, $new)
  }
  return $list.ToArray()
}

# 서비스가 지금 되는지 시험: @(상태, 설명). 상태 = ok · no · warn
function Http-Get([string]$url, $headers) {
  try {
    $r = Invoke-WebRequest -Uri $url -Headers $headers -UseBasicParsing -TimeoutSec 15
    return @{ status = [int]$r.StatusCode; body = [string]$r.Content }
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      $b = ''
      if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $b = [string]$_.ErrorDetails.Message }
      else { try { $resp.GetResponseStream().Position = 0 } catch { }; try { $sr = New-Object System.IO.StreamReader($resp.GetResponseStream()); $b = $sr.ReadToEnd() } catch { } }
      return @{ status = [int]$resp.StatusCode; body = $b }
    }
    return @{ status = 0; body = $_.Exception.Message }
  }
}
function Test-Service($s, [string]$key) {
  if ($s.site -eq 'kakao') {
    $r = Http-Get 'https://dapi.kakao.com/v2/local/search/address.json?query=%EC%84%9C%EC%9A%B8' @{ Authorization = "KakaoAK $key" }
    if ($r.status -ge 200 -and $r.status -lt 300) { return @('ok', '잘 돼요! 이제 전국 주소·장소를 검색할 수 있어요.') }
    if ($r.status -eq 401) { return @('no', '키가 맞지 않아요. 카카오 "REST API 키"를 넣었는지 확인해 주세요 (JavaScript 키 등은 안 돼요).') }
    if ($r.status -eq 403) { return @('no', '카카오맵 사용 설정이 꺼져 있는 것 같아요. developers.kakao.com → 내 애플리케이션 → 제품 설정 → 카카오맵 → 사용 설정 ON.') }
    if ($r.status -eq 0) { return @('warn', '인터넷에 연결되지 않았어요.') }
    return @('warn', "확인하지 못했어요 (HTTP $($r.status)).")
  }
  $k = if ($key.Contains('%')) { $key } else { [uri]::EscapeDataString($key) }
  $kst = (Get-Date).ToUniversalTime().AddHours(8)
  switch ($s.id) {
    'weather' { $url = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst?serviceKey=$k&pageNo=1&numOfRows=1&dataType=JSON&nx=62&ny=128&base_date=$($kst.ToString('yyyyMMdd'))&base_time=$($kst.ToString('HH'))00" }
    'bus'     { $url = "https://apis.data.go.kr/1613000/ArvlInfoInqireService/getCtyCodeList?serviceKey=$k&_type=json" }
    'subway'  { $url = "https://apis.data.go.kr/1613000/SubwayInfo/GetKwrdFndSubwaySttnList?serviceKey=$k&subwayStationName=%EA%B5%AC%EB%A6%AC&numOfRows=3&pageNo=1&_type=json" }
    'signal'  { $url = "https://apis.data.go.kr/B551982/rti/crsrd_map_info?serviceKey=$k&type=json&pageNo=1&numOfRows=2&stdgCd=1100000000" }
  }
  $r = Http-Get $url @{}
  if ($r.status -eq 0) { return @('warn', '인터넷에 연결되지 않았어요.') }
  if ($r.body -match 'SERVICE_KEY_IS_NOT_REGISTERED|ReasonCode"?\s*[:>]\s*"?30\b|등록되지 않은') {
    return @('no', "아직 안 돼요: 이 서비스는 data.go.kr에서 [활용신청]이 안 됐거나 승인 대기 중이에요 (코드 30). 승인되면 이 키 그대로 돼요.")
  }
  if ($r.body -match 'LIMITED_NUMBER|ReasonCode"?\s*[:>]\s*"?22\b') { return @('warn', '오늘 호출 한도를 넘었어요. 내일 다시 돼요.') }
  if ($r.body -match 'SERVICE_ACCESS_DENIED|ReasonCode"?\s*[:>]\s*"?(20|31|32)\b') { return @('no', '접근이 거부됐어요. 키와 활용신청 상태를 확인해 주세요.') }
  if ($r.status -ge 200 -and $r.status -lt 300) { return @('ok', '잘 돼요!') }
  return @('warn', "확인하지 못했어요 (HTTP $($r.status)).")
}
function Show-Result($res) {
  $color = @{ ok = 'Green'; no = 'Red'; warn = 'Yellow' }[$res[0]]
  $tag = @{ ok = '[ OK ]'; no = '[안 됨]'; warn = '[확인]' }[$res[0]]
  Write-Host "   $tag $($res[1])" -ForegroundColor $color
}
function Ask-Key([string]$what) {
  Write-Host ''
  Write-Host "  $what 키를 복사한 뒤, 이 창에서 마우스 오른쪽 버튼을 누르면 붙여 넣어져요." -ForegroundColor Gray
  $raw = Read-Line '  키 붙여 넣고 Enter (그만두려면 그냥 Enter)'
  $key = Clean-Key $raw
  if (-not $key) { if ($raw) { Write-Host '  키로 보이지 않아요. 다시 확인해 주세요.' -ForegroundColor Yellow } ; return '' }
  if ($key.Length -lt 16) { Write-Host '  키가 너무 짧아요. 끝까지 복사했는지 확인해 주세요.' -ForegroundColor Yellow; return '' }
  return $key
}

if (-not (Test-Path $KeyFile)) { Write-Host "파일을 찾을 수 없어요: $KeyFile" -ForegroundColor Red; exit 1 }

while ($true) {
  $lines = Load-Lines
  foreach ($s in $Svc) { $s.value = Get-Value $lines $s }
  Write-Host ''
  Write-Host '==============================================' -ForegroundColor Cyan
  Write-Host '  프로토타입 · API 키 넣기' -ForegroundColor Cyan
  Write-Host '==============================================' -ForegroundColor Cyan
  $choices = @{}
  $n = 0
  foreach ($s in $Svc) {
    if ($s.id -eq 'weather' -and $s.value) { Write-Host "  날씨        [설정됨]  이미 들어 있어서 자동이에요" -ForegroundColor DarkGray; continue }
    $n++
    $choices["$n"] = $s
    $state = if ($s.value) { '[설정됨]' } else { '[비어 있음]' }
    $col = if ($s.value) { 'Green' } else { 'Yellow' }
    Write-Host ("  {0}. {1,-5} " -f $n, $s.short) -NoNewline
    Write-Host $state -ForegroundColor $col -NoNewline
    Write-Host ("  {0}" -f $s.desc)
    $sub = ($s.label -replace '^[^\(]*\(', '' -replace '\)\s*$', '')
    Write-Host ("        {0}" -f $sub) -ForegroundColor DarkGray
  }
  Write-Host ''
  Write-Host '  A. data.go.kr 키 하나를 한 번에 모두 넣기 (날씨·버스·지하철·신호등)'
  Write-Host '  S. 지금 되는지 전부 확인하기'
  Write-Host '  N. 메모장으로 파일 열기'
  Write-Host '  0. 끝내기'
  Write-Host ''
  $c = Read-Line '  번호를 고르고 Enter'
  if ($null -eq $c) { break }
  $c = $c.Trim().ToUpper()
  if ($c -eq '0' -or $c -eq 'Q') { break }
  if ($c -eq 'N') { Start-Process notepad.exe -ArgumentList ('"' + $KeyFile + '"'); continue }
  if ($c -eq 'S') {
    Write-Host ''
    foreach ($s in $Svc) {
      if (-not $s.value) { Write-Host ("  {0,-5} (비어 있음)" -f $s.short) -ForegroundColor DarkGray; continue }
      Write-Host ("  {0}" -f $s.short)
      Show-Result (Test-Service $s $s.value)
    }
    continue
  }
  if ($c -eq 'A') {
    $key = Ask-Key 'data.go.kr 일반 인증키'
    if (-not $key) { continue }
    $lines = Load-Lines
    foreach ($s in $Svc) { if ($s.site -eq 'data.go.kr') { $lines = Set-Value $lines $s $key } }
    Save-Lines $lines
    Write-Host '  저장했어요. 서비스마다 시험해 볼게요...' -ForegroundColor Green
    foreach ($s in $Svc) { if ($s.site -eq 'data.go.kr') { Write-Host ("  {0}" -f $s.short); Show-Result (Test-Service $s $key) } }
    continue
  }
  if ($choices.ContainsKey($c)) {
    $s = $choices[$c]
    $key = Ask-Key $s.short
    if (-not $key) { continue }
    Save-Lines (Set-Value (Load-Lines) $s $key)
    Write-Host '  저장했어요. 이 키가 지금 되는지 시험해 볼게요...' -ForegroundColor Green
    Show-Result (Test-Service $s $key)
    continue
  }
  Write-Host '  메뉴에 있는 번호나 글자를 입력해 주세요.' -ForegroundColor Yellow
}
Write-Host ''
Write-Host '  끝났어요. 저장하면 앱에 바로 반영돼요.' -ForegroundColor Cyan
