'use strict';
/* 示例数据：与托管版一致，5 条拉片 + 5 条知识，均标 sample=true。 */
module.exports = {
  shots: [
    { title: '《示例》办公室对峙', start: '00:00', duration: 4, shotSize: '大全景', camera: '平视', composition: '对称构图，人物居中', movement: '固定', lighting: '冷色顶光，低调', content: '深夜办公室，只剩一盏台灯', action: '他坐在桌后，抬头', emotion: '紧张', dialogue: '', music: '低沉弦乐', sfx: '时钟滴答', transition: '硬切', montage: '建立镜头', why: '先交代空间和压迫感，再切近景', sample: true },
    { title: '《示例》办公室对峙', start: '00:04', duration: 3, shotSize: '过肩特写', camera: '过肩，平视', composition: '三分法，人物在右三分之一', movement: '缓慢推近', lighting: '面部半明半暗', content: '她的侧脸，目光盯着桌上的信', action: '她推开门，停住', emotion: '紧张', dialogue: '你早就知道，对吗？', music: '弦乐渐强', sfx: '', transition: '硬切', montage: '正反打', why: '过肩特写加缓推，收紧对话张力', sample: true },
    { title: '《示例》办公室对峙', start: '00:07', duration: 3, shotSize: '特写', camera: '平视', composition: '居中，面部占满画面', movement: '固定', lighting: '侧光，轮廓清晰', content: '他的眼睛，没有立刻回答', action: '他抬起头，嘴唇微动', emotion: '紧张', dialogue: '……', music: '', sfx: '呼吸声', transition: '硬切', montage: '正反打', why: '反应特写，让观众读出犹豫', sample: true },
    { title: '《示例》海边独白', start: '00:00', duration: 6, shotSize: '远景', camera: '低机位仰拍', composition: '地平线在下三分之一', movement: '缓慢横移', lighting: '暖色夕阳，逆光', content: '海滩上一个人影走向海水', action: '她慢慢走，裙摆被风吹起', emotion: '平静', dialogue: '', music: '钢琴独奏', sfx: '海浪声', transition: '叠化', montage: '情绪蒙太奇', why: '大全景释放情绪，留白', sample: true },
    { title: '《示例》海边独白', start: '00:06', duration: 4, shotSize: '近景', camera: '平视', composition: '人物偏左，留白在右', movement: '固定', lighting: '柔光', content: '她回头看镜头，笑了', action: '回头，微笑', emotion: '喜悦', dialogue: '', music: '钢琴', sfx: '', transition: '硬切', montage: '情绪蒙太奇', why: '近景收住情绪，转折到释然', sample: true },
  ],
  knowledge: [
    { title: '对话紧张时用过肩特写 + 缓推', emotion: '紧张', scene: '对话戏', rhythm: '渐紧', tags: ['特写', '推镜', '对话'], desc: '正反打来回切，镜头缓慢推近，收紧人物关系和情绪张力。', sample: true },
    { title: '情绪释放时切大全景', emotion: '平静', scene: '独白', rhythm: '渐缓', tags: ['全景', '留白'], desc: '从特写切到大全景，让情绪有出口，画面留白。', sample: true },
    { title: '悬疑开场用大全景建立空间', emotion: '悬疑', scene: '开场', rhythm: '缓慢', tags: ['全景', '建立镜头'], desc: '先用大全景交代环境，再切入人物，制造未知感。', sample: true },
    { title: '悲伤用固定近景 + 柔光', emotion: '悲伤', scene: '独白', rhythm: '缓慢', tags: ['近景', '固定'], desc: '镜头不动，让观众停留在人物脸上，柔光弱化冲突。', sample: true },
    { title: '愤怒用快速短镜头拼贴', emotion: '愤怒', scene: '冲突', rhythm: '快速', tags: ['快切', '短镜头'], desc: '多个短镜头快速切换，压缩时间，表现情绪爆发。', sample: true },
  ],
};
