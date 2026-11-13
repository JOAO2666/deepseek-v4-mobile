# DeepSeek-V4-Pro-Qwen3.5-9B (Heretic) — Mobile Web & Colab

Interface mobile (PWA) e notebook corrigido do Google Colab para rodar o modelo [`xtools-at/DeepSeek-V4-Pro-Qwen3.5-9B-UNCENSORED-heretic`](https://huggingface.co/xtools-at/DeepSeek-V4-Pro-Qwen3.5-9B-UNCENSORED-heretic) direto no celular.

## Links Rápidos

- **Web App Mobile (GitHub Pages):** https://joao2666.github.io/deepseek-v4-mobile/
- **Google Colab (GPU T4 4-bit + link público para celular):** [![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/JOAO2666/deepseek-v4-mobile/blob/main/colab/DeepSeek_V4_Pro_9B_Heretic_Colab.ipynb)

## Por que o notebook do Colab foi corrigido?

O link gerado automaticamente pelo Hugging Face carrega o modelo inteiro em BF16 (~19,3 GB) sem quantização, o que causa erro de falta de memória (`CUDA out of memory`) na GPU gratuita T4 (16 GB) do Colab, além de não criar interface web nem URL pública para o celular.

O notebook [`colab/DeepSeek_V4_Pro_9B_Heretic_Colab.ipynb`](colab/DeepSeek_V4_Pro_9B_Heretic_Colab.ipynb) resolve isso:
- Atualiza `transformers>=5.22.1`, `bitsandbytes>=0.50.2`, `accelerate>=1.0.0` e `gradio>=6.0.0`
- Carrega o modelo em **4-bit NF4** (~6 GB de VRAM na T4)
- Gera um link público `https://xxxxx.gradio.live` para abrir direto no navegador do celular ou conectar ao Web App Mobile
