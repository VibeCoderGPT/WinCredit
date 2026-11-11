"""Generate the WinCredit icon set: navy gradient rounded square with a gold serif W."""
import os
from PIL import Image, ImageDraw, ImageFont

S = 256
TOP = (30, 44, 106)     # navy top
BOT = (10, 15, 34)      # deep navy bottom
GOLD = (235, 166, 74)
RING = (235, 166, 74, 120)

grad = Image.linear_gradient('L').resize((S, S))
grad = Image.eval(grad, lambda v: 255 - v)          # 255 at top -> top color on top
top_img = Image.new('RGB', (S, S), TOP)
bot_img = Image.new('RGB', (S, S), BOT)
base = Image.composite(top_img, bot_img, grad)

mask = Image.new('L', (S, S), 0)
d = ImageDraw.Draw(mask)
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=58, fill=255)

icon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
icon.paste(base, (0, 0), mask)

# soft inner highlight + gold ring
draw = ImageDraw.Draw(icon)
draw.rounded_rectangle([4, 4, S - 5, S - 5], radius=54, outline=RING, width=3)
hl = Image.new('L', (S, S), 0)
ImageDraw.Draw(hl).rounded_rectangle([8, 8, S - 9, int(S * 0.55)], radius=50, fill=46)
icon.paste((255, 255, 255, 255), (0, 0), Image.composite(hl, Image.new('L', (S, S), 0), mask))

font_path = r'C:\Windows\Fonts\georgiaz.ttf'
font = ImageFont.truetype(font_path, 158)
bbox = draw.textbbox((0, 0), 'W', font=font)
w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
x = (S - w) / 2 - bbox[0]
y = (S - h) / 2 - bbox[1] - 6
draw.text((x + 4, y + 5), 'W', font=font, fill=(0, 0, 0, 110))
draw.text((x, y), 'W', font=font, fill=GOLD + (255,))

os.makedirs(os.path.join(os.path.dirname(__file__), '..', 'assets'), exist_ok=True)
out = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'assets'))
icon.save(os.path.join(out, 'icon.png'))
icon.save(os.path.join(out, 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
icon.resize((32, 32), Image.LANCZOS).save(os.path.join(out, 'tray.png'))
print('OK ->', out)
