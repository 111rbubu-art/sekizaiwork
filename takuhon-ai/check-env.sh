#!/usr/bin/env bash
# いまのパソコンに何が入っているかを調べるだけ。何も変えない。
# 使い方:  bash check-env.sh   （結果をそのまま貼ってもらえば見ます）
line(){ echo; echo "===== $1 ====="; }

line "OS"
. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"; uname -r

line "GPU"
nvidia-smi --query-gpu=name,memory.total,memory.used,driver_version --format=csv 2>/dev/null || echo "nvidia-smi が無い"
echo "-- GPU を使っているプロセス --"
nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv 2>/dev/null

line "Docker のコンテナ"
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || echo "docker が無い／権限が無い"

line "Docker Compose のまとまり"
docker compose ls 2>/dev/null || echo "-"

line "Ollama"
which ollama && ollama list 2>/dev/null
curl -s --max-time 2 http://localhost:11434/api/tags | head -c 400; echo

line "サービス（systemd）"
systemctl list-units --type=service --state=running 2>/dev/null \
  | grep -iE 'ollama|dify|llama|vllm|open-webui|text-gen|lm-studio' || echo "それらしいものは無し"

line "待ち受けているポート"
(ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null) | grep LISTEN | awk '{print $4, $7}' | sort -u | head -30

line "Python"
python3 -V; python3 -c "import torch;print('torch', torch.__version__, 'cuda', torch.cuda.is_available())" 2>/dev/null || echo "torch は入っていない（この母艦には）"

line "ディスクの空き"
df -h / /opt /var/lib/docker 2>/dev/null | sort -u
